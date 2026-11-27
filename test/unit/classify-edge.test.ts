// Edge cases found in review: what shadows what, whose .gitignore counts, and the instruction files.
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { classify, resolveReal } from '../../src/lib/paths.ts';
import type { PathClass } from '../../src/lib/paths.ts';
import { project, put, tempDir } from '../helpers/project.ts';

const WIN = process.platform === 'win32';

describe('a node_modules folder cannot turn a protected place into "ignored"', () => {
  const p = project({ legacyRoot: 'old-app', generated: ['src/gen'], config: ['settings/extra.cfg'] });
  const cases: [string, PathClass][] = [
    ['tests/node_modules/x/index.js', 'tests'], ['test/node_modules/x.ts', 'tests'], ['tests/real/node_modules/x.ts', 'tests'],
    ['contracts/node_modules/x/index.ts', 'contracts'], ['fixtures/node_modules/x.ts', 'fixtures'],
    ['probes/fixtures/node_modules/x.json', 'fixtures'], ['plan/node_modules/x.md', 'plan'],
    ['.seam/node_modules/x.json', 'seam-records'], ['.claude/node_modules/x.js', 'claude-config'],
    ['old-app/node_modules/x/index.js', 'legacy'], ['src/gen/node_modules/x.ts', 'generated'],
    ['node_modules/x/package.json', 'config-file'], ['src/node_modules/tsconfig.json', 'config-file'],
    ['node_modules/x/index.js', 'ignored'], ['src/node_modules/x.js', 'ignored'], ['dist/tests/x.ts', 'ignored'],
  ];
  test.each(cases)('%s is %s', (relPath, expected) => expect(p.at(relPath)).toBe(expected));
});

describe('the instruction files are Claude config in any folder (R18, R54)', () => {
  const p = project();
  test.each(['CLAUDE.md', 'AGENTS.md', 'AGENTS.project.md', 'claude.md', 'Agents.Project.MD', 'CLAUDE.md.', './CLAUDE.md', 'src/../AGENTS.md', 'CLAUDE.local.md', 'AGENTS.local.md'])(
    '%s is claude-config', (relPath) => expect(p.at(relPath)).toBe('claude-config'),
  );
  test.runIf(WIN)('CLAUDE.md::$DATA is claude-config', () => expect(p.at('CLAUDE.md::$DATA')).toBe('claude-config'));
  test.each(['README.md', 'CLAUDE.md.bak', 'MYCLAUDE.md', 'CLAUDE.mdx', 'CLAUDE.other.md', 'AGENTS.local.md.bak', 'MYAGENTS.md'])(
    '%s is not', (relPath) => expect(p.at(relPath)).not.toBe('claude-config'),
  );
  test('the app folder counts as well when it is not the repo root', () => {
    const q = project({ appRoot: 'seam-app' });
    expect(q.at('seam-app/CLAUDE.md')).toBe('claude-config');
    expect(q.at('CLAUDE.md')).toBe('claude-config');
    expect(q.at('seam-app/src/CLAUDE.md')).toBe('claude-config');
  });
  test('they stay protected when the old app owns the repo root', () => {
    expect(project({ legacyRoot: '.', appRoot: 'seam-app' }).at('CLAUDE.md')).toBe('claude-config');
  });
});

describe('only a .gitignore inside the project counts', () => {
  /** A project in `outer/sub`, where `outer` is the git repo and holds `outer/.gitignore`. */
  function nested(outerIgnore: string) {
    const outer = tempDir();
    execFileSync('git', ['init', '-q'], { cwd: outer });
    put(outer, '.gitignore', outerIgnore);
    return { outer, p: project({}, false, join(outer, 'sub')) };
  }
  test('a .gitignore above the project root cannot hide its code', () => {
    const { p } = nested('sub/src/\nsub/scratch/\n');
    expect(p.at('src/pricing/total.ts')).toBe('app-code');
    expect(p.at('scratch/notes.ts')).toBe('app-code');
    expect(classify(p.ctx, join(p.root, 'src', 'new.ts'))).toBe('app-code');
  });
  test('an outer .gitignore for the whole project does not count either', () => {
    expect(nested('sub/\n').p.at('src/pricing/total.ts')).toBe('app-code');
  });
  test('a pattern in the outer .gitignore that matches by name only does not count', () => {
    expect(nested('*.gen.ts\n').p.at('src/a.gen.ts')).toBe('app-code');
  });
  test('the project\'s own .gitignore still counts, whichever folder of the repo it sits in', () => {
    const { p } = nested('sub/src/\n');
    put(p.root, '.gitignore', 'scratch/\n');
    put(p.root, 'src/inner/.gitignore', '*.tmp.ts\n');
    expect(p.at('scratch/notes.ts')).toBe('ignored');
    expect(p.at('src/inner/a.tmp.ts')).toBe('app-code'); // src/ itself is hidden only by the outer file
    expect(p.at('lib/b.tmp.ts')).toBe('app-code');
    put(p.root, 'lib/.gitignore', '*.tmp.ts\n');
    expect(p.at('lib/c.tmp.ts')).toBe('ignored'); // a new name: answers for b.tmp.ts are already kept
  });
  test('a project at the top of the repo is unchanged', () => {
    const q = project();
    put(q.root, '.gitignore', 'scratch/\n');
    expect(q.at('scratch/x.ts')).toBe('ignored');
  });
});

describe('a relative ctx.root is resolved once', () => {
  test('classify gives the same answers as with the absolute root', () => {
    const p = project();
    const ctx = { ...p.ctx, root: relative(process.cwd(), p.root) };
    for (const [path, expected] of [['.seam/state.json', 'seam-records'], ['src/pricing/total.ts', 'app-code'], ['plan/plan.json', 'plan']] as const) {
      expect(classify(ctx, join(p.root, path))).toBe(expected);
      expect(classify(ctx, resolveReal(p.root, path))).toBe(expected);
    }
  });
});
