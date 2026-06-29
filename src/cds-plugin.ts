import { createRequire } from 'node:module'
import path from 'node:path'
import type { BuildPlugin } from '@/lib/TypeScriptBuildPlugin'

// Resolve @sap/cds from the consuming project's directory (process.cwd()),
// not from this file's location. This is critical when the plugin is consumed
// via `npm link`, where Node.js would otherwise resolve @sap/cds from the
// plugin's own node_modules — yielding a different, uninitialized cds instance
// that lacks cds.build.
const projectRequire = createRequire(path.join(process.cwd(), 'package.json'))
const cds: typeof import('@sap/cds') = projectRequire('@sap/cds')

type CdsWithBuild = typeof cds & {
  build?: {
    Plugin: typeof BuildPlugin
    register(id: string, plugin: typeof BuildPlugin): void
  }
}

const LOG = cds.log('cds-plugin-typescript')

try {
  const cdsWithBuild = cds as CdsWithBuild
  if (typeof cdsWithBuild.build?.register === 'function') {
    LOG.info('Registering build plugin.')
    const { TypeScriptBuildPlugin } = await import(
      '@/lib/TypeScriptBuildPlugin.js'
    )
    // biome-ignore lint/style/noNonNullAssertion: checked above
    ;(cds as CdsWithBuild).build!.register('typescript', TypeScriptBuildPlugin)
  }
} catch (err) {
  LOG.error('Failed to register build plugin.', err)
}
