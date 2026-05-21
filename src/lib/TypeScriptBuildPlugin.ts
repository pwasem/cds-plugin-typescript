import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { cwd } from 'node:process'
import { createInterface } from 'node:readline'
import type cdsType from '@sap/cds'

// Determine project root
const PROJECT_ROOT = cwd()

// Resolve @sap/cds from the consuming project's directory (process.cwd()),
// not from this file's location. This is critical when the plugin is consumed
// via `npm link`, where Node.js would otherwise resolve @sap/cds from the
// plugin's own node_modules — yielding a different, uninitialized cds instance
// that lacks cds.build.Plugin.
const projectRequire = createRequire(path.join(PROJECT_ROOT, 'package.json'))
const cds: typeof cdsType = projectRequire('@sap/cds')

const LOG = cds.log('cds-plugin-typescript')

export interface TypeScriptPluginOptions {
  tsConfig: string
}

export interface BuildTask {
  src: string
  dest: string
  options: TypeScriptPluginOptions
}

export type MessageSeverity = 'info' | 'warn' | 'error'

export declare abstract class BuildPlugin {
  public static readonly INFO: MessageSeverity
  public static readonly WARNING: MessageSeverity
  public static readonly ERROR: MessageSeverity
  public static taskDefaults?: Partial<BuildTask>
  public static hasTask?(): boolean | Promise<boolean>
  public readonly task: BuildTask
  public get priority(): number
  public init?(): void | Promise<void>
  public clean?(): Promise<void>
  public build?(): Promise<void>
  public model(): Promise<Record<string, unknown> | undefined>
  public baseModel(): Promise<Record<string, unknown> | undefined>
  public write(content: unknown): {
    to(path: string): Promise<void>
  }
  public copy(src: string): {
    to(dest: string): Promise<void>
  }
  public pushMessage(message: string, severity?: MessageSeverity): void
}
/**
 * Resolve the CDS Build Plugin base class from the consuming project's @sap/cds.
 *
 * This module is dynamically required by cds-plugin.ts only after confirming
 * that cds.build exists, so cds.build.Plugin is guaranteed to be available
 * at this point.
 */
const CdsBuildPlugin = (
  cds as typeof cds & {
    build: {
      Plugin: typeof BuildPlugin
    }
  }
).build.Plugin

const { INFO, WARNING, ERROR } = CdsBuildPlugin

/**
 * TypeScript build plugin for the CDS build system.
 *
 * Configuration via task options (package.json, .cdsrc.json, etc.):
 * ```json
 * { "for": "typescript", "options": {
 *   "tsConfig": "tsconfig.cds.json"
 * }}
 * ```
 *
 * Path alias resolution via `tsc-alias` is automatically enabled when
 * `tsc-alias` is found in the project's package.json dependencies or devDependencies.
 */
export class TypeScriptBuildPlugin extends CdsBuildPlugin {
  /**
   * Default task configuration.
   */
  public static override taskDefaults: Partial<BuildTask> = {
    options: {
      tsConfig: '',
    },
  }

  /**
   * Run before other build plugins so compiled JS is available.
   */
  public override get priority(): number {
    // REVISE: properly determine priority relative to other plugins if needed
    return -1 // lower priority than the nodejs task
  }

  /**
   * Compile TypeScript sources to JavaScript and resolve path aliases.
   *
   * Steps:
   * 1. Resolve the tsconfig (prefers configured name, falls back to convention)
   * 2. Run `tsc` with --outDir pointing to the task destination
   * 3. Optionally run `tsc-alias` to resolve path aliases in the compiled output
   * 4. Optionally remove TypeScript source files from the output
   */
  public override async build(): Promise<void> {
    const tsconfigPath = await this.resolveTsconfigPath(this.task)
    if (!tsconfigPath) {
      this.pushMessage(
        `No tsconfig found in ${PROJECT_ROOT}. Checked task options, tsconfig.cdsbuild.json, tsconfig.build.json, and tsconfig.json.`,
        ERROR,
      )
      return
    }

    const relativeTsconfig = path.relative(PROJECT_ROOT, tsconfigPath)
    LOG.info(`Compiling TypeScript using ${relativeTsconfig}`)
    await this.runTsc(tsconfigPath)

    if (await this.hasTscAliasInstalled()) {
      LOG.info(`Resolving path aliases using ${relativeTsconfig}`)
      await this.runTscAlias(tsconfigPath)
    }

    LOG.info('Removing TypeScript sources')
    await this.removeTypeScriptSources()
  }

  /**
   * Execute a command within the plugin's task source directory.
   * Streams stdout as INFO messages and stderr with the given severity.
   * Returns the exit code of the child process.
   */
  private async execCommand(
    cmd: string,
    args: string[],
    stderrSeverity: MessageSeverity = ERROR,
  ): Promise<number> {
    const child = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      stdio: [
        'ignore',
        'pipe',
        'pipe',
      ],
    })

    if (child.stdout) {
      const rl = createInterface({
        input: child.stdout,
      })
      rl.on('line', (line) => this.pushMessage(line, INFO))
    }

    if (child.stderr) {
      const rl = createInterface({
        input: child.stderr,
      })
      rl.on('line', (line) => this.pushMessage(line, stderrSeverity))
    }

    const [code] = (await once(child, 'close')) as [
      number,
    ]

    return code
  }

  /**
   * Run the TypeScript compiler via CLI.
   * Captures stderr for error reporting through the build framework.
   */
  private async runTsc(tsconfigPath: string): Promise<void> {
    const code = await this.execCommand('npx', [
      'tsc',
      '-p',
      tsconfigPath,
    ])

    if (code !== 0) {
      this.pushMessage(
        `TypeScript compilation failed (exit code ${code})`,
        ERROR,
      )
    }
  }

  /**
   * Run tsc-alias to resolve path aliases in the compiled output.
   */
  private async runTscAlias(tsconfigPath: string): Promise<void> {
    const code = await this.execCommand(
      'npx',
      [
        'tsc-alias',
        '-p',
        tsconfigPath,
      ],
      WARNING,
    )

    if (code !== 0) {
      this.pushMessage(`tsc-alias failed (exit code ${code})`, WARNING)
    }
  }

  /**
   * Remove .ts source files from the destination directory.
   * CAP's Node.js build copies them over before this plugin runs.
   */
  private async removeTypeScriptSources(): Promise<void> {
    const tsFiles = await Array.fromAsync(
      fs.glob('**/*.ts', {
        cwd: this.task.dest,
        exclude: (filePath) => filePath.endsWith('.d.ts'),
      }),
    )

    const tsPaths = tsFiles.map((file) => path.join(this.task.dest, file))
    await Promise.all(tsPaths.map((tsPath) => fs.rm(tsPath)))
  }

  /**
   * Resolve the path to the TypeScript configuration file.
   *
   * Resolution order:
   * 1. Path specified in task options (`options.tsConfig`)
   * 2. `tsconfig.cdsbuild.json` in the project root
   * 3. `tsconfig.build.json` in the project root
   * 4. `tsconfig.json` in the project root
   */
  private async resolveTsconfigPath(
    task: BuildTask,
  ): Promise<string | undefined> {
    // 1. Check if a tsconfig path is specified in the build task options
    // biome-ignore lint/complexity/useLiteralKeys: options object is expected to grow in the future, so this is more maintainable than destructuring with a default value
    const optionsPath = task.options?.['tsConfig'] as string | undefined
    if (optionsPath) {
      const resolvedOptionsPath = path.resolve(PROJECT_ROOT, optionsPath)
      if (await this.fileExists(resolvedOptionsPath)) {
        return resolvedOptionsPath
      }
    }

    // 2. Check for tsconfig files in priority order
    const candidates = [
      'tsconfig.cdsbuild.json',
      'tsconfig.build.json',
      'tsconfig.json',
    ]

    for (const candidate of candidates) {
      const candidatePath = path.resolve(PROJECT_ROOT, candidate)
      if (await this.fileExists(candidatePath)) {
        return candidatePath
      }
    }

    return undefined
  }

  /**
   * Check whether `tsc-alias` is listed in the project's package.json
   * dependencies or devDependencies.
   */
  private async hasTscAliasInstalled(): Promise<boolean> {
    try {
      const pkgPath = path.join(PROJECT_ROOT, 'package.json')
      const content = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(content) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      return (
        'tsc-alias' in (pkg.dependencies ?? {}) ||
        'tsc-alias' in (pkg.devDependencies ?? {})
      )
    } catch {
      return false
    }
  }

  /**
   * Check whether a path exists on the filesystem.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}
