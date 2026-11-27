// Bundles the hook and the seam command into dist/. The plugin ships without node_modules,
// so `typescript` and `zod` are inlined; only Node's own modules may stay as imports.
// dist/ is committed on purpose: Claude Code runs it straight from the plugin folder.
//
// The bundle is split: dist/hook.mjs, dist/hook-worker.mjs (the worker thread the hook runs its decisions
// in, which must sit next to hook.mjs) and dist/seam.mjs are the entry points, and code that only some
// hook runs need (the TypeScript parser, which only a code write needs) is in dist/chunks/ and is
// loaded by `import()` when it is needed. A read or a command then never pays for parsing TypeScript.
import { rmSync } from 'node:fs';
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

// Chunk names change with their content, so clear the old ones or they pile up in the repo.
rmSync('dist/chunks', { recursive: true, force: true });

const result = await build({
  entryPoints: { hook: 'src/hook.ts', 'hook-worker': 'src/hook-worker.ts', seam: 'src/cli/seam.ts' },
  outdir: 'dist',
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: { js: banner },
  legalComments: 'none',
  minify: true,
  metafile: true,
  logLevel: 'info',
});

const outputs = result.metafile.outputs;

// Fail the build if anything other than a Node built-in or one of our own chunks is left as an import.
// typescript also tries `require('source-map-support')` inside a try/catch and carries on
// without it, so that one optional import is allowed.
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'source-map-support']);
const leftovers = Object.entries(outputs).flatMap(([file, out]) =>
  out.imports.filter((imp) => !builtins.has(imp.path) && !(imp.path in outputs)).map((imp) => `${file} imports ${imp.path}`),
);
if (leftovers.length > 0) {
  console.error(`The bundle must not import anything but Node built-ins:\n${leftovers.join('\n')}`);
  process.exit(1);
}

// Fail the build if the hook, or the first thing its worker loads, would pull in a big library on every run:
// the TypeScript parser (only a code write needs it) or zod (only a call in a seam project needs it). The
// main thread must stay tiny, and the worker must be able to answer "no seam project involved" without them.
// Follow what an entry imports at load time (not what it imports with `import()` later) and look inside.
function loadedAtStart(entry) {
  const seen = new Set();
  const todo = [entry];
  while (todo.length > 0) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const imp of outputs[file].imports) {
      if (imp.kind === 'import-statement' && imp.path in outputs) todo.push(imp.path);
    }
  }
  return [...seen];
}
for (const entry of ['dist/hook.mjs', 'dist/hook-worker.mjs']) {
  for (const [name, folder] of [['the TypeScript parser', 'node_modules/typescript/'], ['zod', 'node_modules/zod/']]) {
    const eager = loadedAtStart(entry).filter((file) => Object.keys(outputs[file].inputs).some((input) => input.includes(folder)));
    if (eager.length > 0) {
      console.error(`${entry} would load ${name} on every run (it is in ${eager.join(', ')}).`);
      console.error('Load whatever uses it with import() inside the function that needs it.');
      process.exit(1);
    }
  }
}

// The hook finds its worker by name, next to itself.
if (!('dist/hook-worker.mjs' in outputs)) {
  console.error('dist/hook-worker.mjs was not built; the hook cannot run its decisions without it.');
  process.exit(1);
}
