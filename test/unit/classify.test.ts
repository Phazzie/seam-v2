import { symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { classify, isCodeFile, resolveReal } from '../../src/lib/paths.ts';
import type { PathClass } from '../../src/lib/paths.ts';
import { project, put } from '../helpers/project.ts';

const WIN = process.platform === 'win32';

describe('classify', () => {
  const p = project({ config: ['package.json', 'tsconfig.json', 'vitest.config.ts', 'settings/extra.cfg'], generated: ['src/routeTree.gen.ts', 'src/gen'] });

  test.each(['src/pricing/total.ts', './src/../src/pricing/total.ts', 'src/pricing/total.ts.', 'src/pricing/total.ts::$DATA'])(
    '%s classifies like src/pricing/total.ts', (rawPath) => expect(classify(p.ctx, resolveReal(p.root, rawPath))).toBe('app-code'),
  );
  test.runIf(WIN)('SRC\\Pricing\\Total.ts classifies like src/pricing/total.ts', () => {
    expect(classify(p.ctx, resolveReal(p.root, 'SRC\\Pricing\\Total.ts'))).toBe('app-code');
  });
  test('classify resolves its argument itself, so a caller cannot hand it a spelling it would misjudge', () => {
    expect(classify(p.ctx, join(p.root, 'src', '..', '.seam', 'state.json'))).toBe('seam-records');
    expect(classify(p.ctx, join(p.root, 'PLAN', 'plan.json'))).toBe(WIN ? 'plan' : 'app-code');
  });

  const cases: [string, PathClass][] = [
    ['.seam/state.json', 'seam-records'], ['.seam/verdicts/a.json', 'seam-records'], ['.seam', 'seam-records'],
    ['.claude/settings.json', 'claude-config'], ['.claude/hooks/x.mjs', 'claude-config'],
    ['plan/plan.json', 'plan'], ['plan/FEATURES.md', 'plan'],
    ['contracts/order.ts', 'contracts'], ['tests/a.test.ts', 'tests'], ['tests/real/b.test.ts', 'tests'], ['test/a.test.ts', 'tests'],
    ['tests/fixtures/x.ts', 'tests'], ['fixtures/orders.ts', 'fixtures'], ['probes/fixtures/orders.json', 'fixtures'],
    ['package.json', 'config-file'], ['package-lock.json', 'config-file'], ['tsconfig.json', 'config-file'],
    ['tsconfig.app.json', 'config-file'], ['vitest.config.ts', 'config-file'], ['vite.config.mts', 'config-file'],
    ['eslint.config.js', 'config-file'], ['src/deep/tsconfig.json', 'config-file'], ['settings/extra.cfg', 'config-file'],
    ['.gitignore', 'config-file'], ['src/.gitignore', 'config-file'], ['.git/info/exclude', 'config-file'], ['.git/hooks/pre-commit', 'config-file'],
    ['src/routeTree.gen.ts', 'generated'], ['src/gen/a.ts', 'generated'], ['src/generated-by-hand.ts', 'app-code'],
    ['src/pricing/total.ts', 'app-code'], ['src/greeting/Greeting.tsx', 'app-code'], ['db/schema.sql', 'app-code'], ['src/data.json', 'app-code'],
    ['scripts/build.mjs', 'app-code'],
    ['probes/run.json', 'other-in-repo'], ['README.md', 'other-in-repo'], ['src/index.css', 'other-in-repo'], ['', 'other-in-repo'],
    ['node_modules/x/index.js', 'ignored'], ['src/node_modules/y.js', 'ignored'],
    ['dist/bundle.js', 'ignored'], ['.next/server.js', 'ignored'], ['coverage/lcov.info', 'ignored'],
  ];
  test.each(cases)('%s is %s', (relPath, expected) => expect(p.at(relPath)).toBe(expected));

  test('paths outside the repo are "outside"', () => {
    expect(classify(p.ctx, join(dirname(p.root), 'elsewhere', 'a.ts'))).toBe('outside');
    expect(classify(p.ctx, `${p.root}-sibling/a.ts`)).toBe('outside');
  });
  test('the plugin folder, the data folder and the user\'s Claude config are protected places', () => {
    expect(classify(p.ctx, join(p.ctx.pluginRoot, 'dist', 'hook.mjs'))).toBe('plugin');
    expect(classify(p.ctx, join(p.ctx.dataDir, 'projects.json'))).toBe('data-dir');
    expect(classify(p.ctx, join(p.ctx.dataDir, 'mirror', 'a', 'b'))).toBe('data-dir');
    const claude = join(homedir(), '.claude');
    expect(classify(p.ctx, join(claude, 'settings.json'))).toBe('user-claude-config');
    expect(classify(p.ctx, join(claude, 'settings.local.json'))).toBe('user-claude-config');
    expect(classify(p.ctx, join(claude, 'plugins', 'cache', 'x', 'hooks.json'))).toBe('user-claude-config');
    expect(classify(p.ctx, join(claude, 'projects', 'notes.md'))).toBe('outside');
  });
  test('a plugin or data folder inside ~/.claude/plugins is still "plugin" or "data-dir", the more exact answer', () => {
    const home = join(homedir(), '.claude', 'plugins');
    const ctx = { ...p.ctx, pluginRoot: join(home, 'cache', 'seam-v2'), dataDir: join(home, 'data', 'seam-v2') };
    expect(classify(ctx, join(ctx.pluginRoot, 'dist', 'hook.mjs'))).toBe('plugin');
    expect(classify(ctx, join(ctx.dataDir, 'projects.json'))).toBe('data-dir');
    expect(classify(ctx, join(home, 'other', 'x.json'))).toBe('user-claude-config');
  });
  test('a folder reached through a link is classified by where it really is', () => {
    const q = project();
    symlinkSync(join(q.root, '.seam'), join(q.root, 'innocent'), 'junction');
    expect(q.at('innocent/state.json')).toBe('seam-records');
    // Not through resolveReal first: classify must follow the link itself.
    expect(classify(q.ctx, join(q.root, 'innocent', 'state.json'))).toBe('seam-records');
    expect(classify(q.ctx, join(q.root, 'innocent', 'new-file.json'))).toBe('seam-records');
  });
  test('without a plan (setup phase) the fixed rules still hold', () => {
    const q = project();
    const ctx = { ...q.ctx, plan: null };
    expect(classify(ctx, join(q.root, 'src', 'a.ts'))).toBe('app-code');
    expect(classify(ctx, join(q.root, '.seam', 'state.json'))).toBe('seam-records');
  });

  describe('legacy tree', () => {
    test('a legacy folder is protected, the new app beside it is not', () => {
      const q = project({ legacyRoot: 'old-app' });
      expect(q.at('old-app/src/index.ts')).toBe('legacy');
      expect(q.at('old-app/package.json')).toBe('legacy');
      expect(q.at('src/pricing/total.ts')).toBe('app-code');
    });
    test('with the old app at the repo root and the new one in seam-app/, only seam-app/ and the records are not legacy', () => {
      const q = project({ legacyRoot: '.', appRoot: 'seam-app' });
      expect(q.at('index.ts')).toBe('legacy');
      expect(q.at('src/old.ts')).toBe('legacy');
      expect(q.at('tests/old.test.ts')).toBe('legacy');
      expect(q.at('seam-app/src/pricing/total.ts')).toBe('app-code');
      expect(q.at('seam-app/tests/a.test.ts')).toBe('tests');
      expect(q.at('seam-app/contracts/a.ts')).toBe('contracts');
      expect(q.at('seam-app/probes/fixtures/a.json')).toBe('fixtures');
      expect(q.at('seam-app/probes/notes.json')).toBe('other-in-repo');
      expect(q.at('plan/plan.json')).toBe('plan');
      expect(q.at('.seam/state.json')).toBe('seam-records');
    });
  });

  describe('git-ignored paths', () => {
    const g = project();
    put(g.root, '.gitignore', 'Scratch/\n*.generated.ts\n!keep.generated.ts\n');
    put(g.root, '.git/info/exclude', 'sneaky/\n');
    test('a .gitignore in the repo makes a path ignored (matching ignores case on Windows)', () => {
      expect(g.at('scratch/notes.ts')).toBe(WIN ? 'ignored' : 'app-code');
      expect(g.at('Scratch/notes.ts')).toBe('ignored');
      expect(g.at('src/a.generated.ts')).toBe('ignored');
    });
    test('a negated pattern keeps the path guarded', () => {
      expect(g.at('src/keep.generated.ts')).toBe('app-code');
    });
    test('the repo\'s private exclude file does not hide code from the guard', () => {
      expect(g.at('sneaky/x.ts')).toBe('app-code');
    });
    test('a folder that is not a git repo has no ignored paths, and does not crash', () => {
      const n = project({}, false);
      put(n.root, '.gitignore', '*.generated.ts\n');
      expect(n.at('src/a.generated.ts')).toBe('app-code');
      expect(n.at('src/pricing/total.ts')).toBe('app-code');
      expect(n.at('node_modules/x.js')).toBe('ignored');
    });
    test('an answer is kept for the rest of the run', () => {
      const c = project();
      put(c.root, '.gitignore', 'cached/\n');
      expect(c.at('cached/a.ts')).toBe('ignored');
      put(c.root, '.gitignore', '');
      expect(c.at('cached/a.ts')).toBe('ignored');
      expect(c.at('fresh/a.ts')).toBe('app-code');
    });
  });
});

describe('isCodeFile', () => {
  test.each(['a.ts', 'a.tsx', 'a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'src/a.d.ts', 'SRC\\A.TS', './src/a.ts', 'src/a.ts.', 'db/x.sql', 'package.json', 'src/data.json', 'src/probes/x.json'])(
    '%s is code', (p) => expect(isCodeFile(p)).toBe(true),
  );
  test.each(['probes/x.json', 'probes/a/b.sql', './probes/x.json', 'PROBES\\x.json', '.seam/state.json', 'README.md', 'a.css', 'a.png', 'a.tsx.map', 'src/Makefile', 'src/noext'])(
    '%s is not code', (p) => expect(isCodeFile(p)).toBe(false),
  );
  test('.json under probes is not code', () => expect(isCodeFile('probes/x.json')).toBe(false));
});
