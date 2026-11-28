// R51 and R52: what counts as code, and which files make a tool run code or read its settings from the repo.
// `.mts` and `.cts` are code like `.ts`. `.npmrc`, `.babelrc`, `.env` and the like are config files, wherever
// they are in the repo (and even when git ignores them), so the main AI cannot write them.
import { describe, expect, test } from 'vitest';
import { asMain } from '../helpers/app.ts';
import { classify, isCodeFile, resolveReal } from '../../src/lib/paths.ts';
import { isAllowed, reasonOf, scene, writes } from '../helpers/decide.ts';
import { project } from '../helpers/project.ts';

const p = project();

describe('R51: .mts and .cts are code files', () => {
  test.each(['a.mts', 'a.cts', 'src/deep/a.mts', 'src/a.d.cts', 'SRC/A.MTS', 'src/a.mts.'])('%s is code', (path) => {
    expect(isCodeFile(path)).toBe(true);
  });
  test.each(['src/a.mts', 'src/a.cts', 'lib/x.d.mts'])('%s is app code to the classifier', (path) => {
    expect(classify(p.ctx, resolveReal(p.root, path))).toBe('app-code');
  });
  test.each(['a.mt', 'a.ct', 'a.mtsx', 'a.cts.md', 'a.mts.json.txt'])('%s is not', (path) => {
    expect(isCodeFile(path)).toBe(false);
  });
  test.each(['src/evil.mts', 'src/evil.cts', 'lib/evil.d.mts'])('the main AI cannot write %s (it is not in the plan, and app code is for builders)', async (rel) => {
    const s = await scene();
    expect(await reasonOf(writes(s, rel, 'x\n', asMain()))).toMatch(/not in the plan/);
  });
});

const CONFIG = [
  '.npmrc', '.yarnrc', '.yarnrc.yml', '.babelrc', '.babelrc.json', '.babelrc.js', 'babel.config.js', 'babel.config.json', 'babel.config.cjs',
  '.swcrc', '.env', '.env.local', '.env.production', '.env.example', '.nvmrc', '.node-version', '.tool-versions',
];

describe('R52: code-running and code-shaping config files are config files, anywhere in the repo', () => {
  test.each(CONFIG)('%s', (name) => {
    expect(classify(p.ctx, resolveReal(p.root, name))).toBe('config-file');
    expect(classify(p.ctx, resolveReal(p.root, `packages/app/${name}`))).toBe('config-file');
    expect(classify(p.ctx, resolveReal(p.root, `src/deep/er/${name}`))).toBe('config-file');
  });
  test('whatever the letter case', () => {
    for (const name of ['.NPMRC', '.Babelrc.JSON', 'Babel.Config.JS', '.ENV.local']) {
      expect(classify(p.ctx, resolveReal(p.root, name))).toBe('config-file');
    }
  });
  test('git ignoring one does not make it ignored (config wins)', async () => {
    const s = await scene({ files: { '.gitignore': '.env\n.env.*\n.npmrc\n' } });
    expect(await reasonOf(writes(s, '.env', 'KEY=1\n', asMain()))).toMatch(/config files are frozen/);
    expect(await reasonOf(writes(s, 'sub/.env.local', 'KEY=1\n', asMain()))).toMatch(/config files are frozen/);
    expect(await reasonOf(writes(s, '.npmrc', 'x\n', asMain()))).toMatch(/config files are frozen/);
  });
  test('inside node_modules too: the config answer comes first', () => {
    expect(classify(p.ctx, resolveReal(p.root, 'node_modules/x/.npmrc'))).toBe('config-file');
  });
  test.each(['.envrc', 'env.ts', 'src/.environment', 'src/env.d.ts', 'babel.md', 'notes.env.md', '.nvmrc.bak', 'npmrc', 'src/.swcrc.ts'])('%s is not one of them', (name) => {
    expect(classify(p.ctx, resolveReal(p.root, name))).not.toBe('config-file');
  });
});

describe('R52: the main AI cannot write them, in any phase', () => {
  test.each(CONFIG)('%s', async (name) => {
    const s = await scene();
    expect(await reasonOf(writes(s, name, 'x\n', asMain()))).toMatch(/^config files are frozen; they're written by the seam scripts$/);
    expect(await reasonOf(writes(s, `packages/app/${name}`, 'x\n', asMain()))).toMatch(/config files are frozen/);
  });
  test('while an ordinary dotfile is the main AI\'s to write', async () => {
    const s = await scene();
    await isAllowed(writes(s, '.envrc', 'x\n', asMain()));
    await isAllowed(writes(s, 'notes.env.md', 'x\n', asMain()));
  });
});
