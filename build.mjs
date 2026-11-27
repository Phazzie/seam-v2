// Bundles the hook and the seam command into dist/. The plugin ships without node_modules,
// so `typescript` and `zod` are inlined; only Node's own modules may stay as imports.
// dist/ is committed on purpose: Claude Code runs it straight from the plugin folder.
import { builtinModules } from 'node:module';
import { build } from 'esbuild';

// typescript's bundled code expects CommonJS globals; give the ES module bundle the same.
const banner = [
  "import { createRequire as __seamCreateRequire } from 'node:module';",
  "import { fileURLToPath as __seamFileURLToPath } from 'node:url';",
  "import { dirname as __seamDirname } from 'node:path';",
  'const require = __seamCreateRequire(import.meta.url);',
  'const __filename = __seamFileURLToPath(import.meta.url);',
  'const __dirname = __seamDirname(__filename);',
].join('\n');

const result = await build({
  entryPoints: { hook: 'src/hook.ts', seam: 'src/cli/seam.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: { js: banner },
  legalComments: 'none',
  minify: true,
  metafile: true,
  logLevel: 'info',
});

// Fail the build if anything other than a Node built-in is left as an import.
// typescript also tries `require('source-map-support')` inside a try/catch and carries on
// without it, so that one optional import is allowed.
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'source-map-support']);
const leftovers = Object.entries(result.metafile.outputs).flatMap(([file, out]) =>
  out.imports.filter((imp) => !builtins.has(imp.path)).map((imp) => `${file} imports ${imp.path}`),
);
if (leftovers.length > 0) {
  console.error(`The bundle must not import anything but Node built-ins:\n${leftovers.join('\n')}`);
  process.exit(1);
}
