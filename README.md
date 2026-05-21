# cds-plugin-typescript

A [CDS build plugin](https://cap.cloud.sap/docs/guides/deploy/build#custom-build-tasks) for [SAP CAP](https://cap.cloud.sap) that compiles TypeScript sources to JavaScript as part of `cds build`.

It is similar to [cds-typer](https://cap.cloud.sap/docs/tools/cds-typer) but focused exclusively on TypeScript compilation. It also supports resolving [TypeScript path aliases](https://www.typescriptlang.org/tsconfig#paths) via [`tsc-alias`](https://github.com/justkey007/tsc-alias).

## Prerequisites

- Node.js `>=22`
- npm `>=10`
- `@sap/cds` `>=8`
- `typescript` `>=5`
- `tsc-alias` `>=1` (optional — automatically detected and used if listed in your project's `package.json`)

## Installation

```bash
npm install --save-dev cds-plugin-typescript
```

## Usage

Once installed, the plugin is automatically discovered and activated — no manual registration needed. It's a [cds-plugin](https://cap.cloud.sap/docs/node.js/cds-plugins) and will be loaded by CAP automatically.

Simply run `cds build` and the plugin will:

1. Detect your tsconfig file (see [tsconfig resolution](#tsconfig-resolution) below)
2. Compile TypeScript sources with `tsc`
3. Resolve path aliases with `tsc-alias` (automatic — runs if `tsc-alias` is found in your project's dependencies or devDependencies)
4. Remove `.ts` source files from the build output

## Configuration

**Zero configuration is required by default.** Simply:

1. Install the plugin (`npm install --save-dev cds-plugin-typescript`)
2. Maintain a tsconfig file — the plugin automatically looks for `tsconfig.cdsbuild.json`, `tsconfig.build.json`, or `tsconfig.json` (first found wins)
3. Run `cds build`

That's it — no `package.json` changes needed.

### Custom tsConfig path

The `cds.build.tasks` configuration in `package.json` is **only** needed if you want to point the plugin at a tsconfig file with a non-standard name (i.e. something other than the three files listed above):

```json
{
  "cds": {
    "build": {
      "tasks": [
        { "for": "nodejs" },
        {
          "for": "typescript",
          "options": {
            "tsConfig": "tsconfig.custom.json"
          }
        }
      ]
    }
  }
}
```

| Option     | Type     | Default | Description                                                                                        |
| ---------- | -------- | ------- | -------------------------------------------------------------------------------------------------- |
| `tsConfig` | `string` | —       | Custom TypeScript config file path. When provided, this takes highest priority in the resolution order. |

### tsconfig resolution

The plugin resolves the tsconfig file using the following priority order:

1. **Custom path** via the `tsConfig` option (if provided in the build task configuration)
2. **`tsconfig.cdsbuild.json`** — a CDS-build-specific config
3. **`tsconfig.build.json`** — a general build-specific config
4. **`tsconfig.json`** — the standard TypeScript config

The plugin uses the first file found in this order. This allows you to maintain separate TypeScript configurations for CDS builds, general builds, and development without conflicts.

The default/recommended tsconfig for the default CDS folder structure is:

```json
{
  "compilerOptions": {
    "rootDir": "srv",
    "outDir": "gen/srv/srv",
    "declaration": true,
    "sourceMap": true,
    "removeComments": true
  },
  "include": [
    "srv/**/*"
  ]
}
```

> The `outDir` in your tsconfig determines where compiled output lands — make sure it aligns with your CDS build target (default: `gen`).

### Path aliases

If your project uses TypeScript path aliases (e.g. `@/*` → `src/*`), simply add `tsc-alias` to your project's dependencies or devDependencies:

```bash
npm install --save-dev tsc-alias
```

The plugin automatically detects whether `tsc-alias` is listed in your `package.json` (under `dependencies` or `devDependencies`) and runs it after `tsc` to rewrite the aliases in the compiled JavaScript. No additional configuration is needed.

If `tsc-alias` is not listed in your `package.json`, the path alias resolution step is skipped entirely.

## How it works

The plugin extends `cds.build.Plugin` and is registered under the task type `typescript`.

**Build steps:**

1. Resolve the tsconfig path (priority: `tsConfig` option → `tsconfig.cdsbuild.json` → `tsconfig.build.json` → `tsconfig.json`)
2. Run `npx tsc -p <tsconfig>` from the task source directory — logs: "Compiling TypeScript using \<tsconfig\>"
3. If `tsc-alias` is detected in `package.json`: run `npx tsc-alias -p <tsconfig>` — logs: "Resolving path aliases"
4. Delete all `.ts` files (excluding `.d.ts`) from the build output — logs: "Removing TypeScript sources"

**Clean step:**

`cds build --clean` removes all `.js` and `.map` files emitted by this plugin from the destination directory.

## Related

- [CAP Custom Build Tasks](https://cap.cloud.sap/docs/guides/deploy/build#custom-build-tasks)
- [CDS Build API](https://cap.cloud.sap/docs/tools/apis/cds-build#add-build-task-type-to-cds-schema)
- [cds-typer](https://cap.cloud.sap/docs/tools/cds-typer)
- [tsc-alias](https://github.com/justkey007/tsc-alias)

## License

[MIT](LICENSE)
