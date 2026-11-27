// R21 carried from Task 8: the hook finds the project from the folders a call names, and a Glob's `pattern`
// and a Grep's `glob` can name one when they are absolute. Their literal prefix (the text before the first
// wildcard, up to its last separator) is a target, in the one shared `targetsOf`, so the cheap check and the
// full lookup both see it. A relative pattern names nothing: it is read from `path`.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { whySeamPossible } from '../../src/guard/inert.ts';
import { resolveProject } from '../../src/guard/project.ts';
import { filterOf, literalPrefix, targetsOf } from '../../src/guard/request.ts';
import { registerProject, resolveReal } from '../../src/lib/paths.ts';
import { asBuilder, makeApp } from '../helpers/app.ts';
import { expectDenied, pre } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';
import { blocksOf, call, heartbeatSeen, reasonOf } from '../helpers/inproc.ts';
import { tempDir } from '../helpers/project.ts';

const input = (tool: string, toolInput: Record<string, unknown>, cwd = '/work') => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, cwd });
const TESTS = "builders don't read tests; you'll be told which promise failed";
const TWO = 'this action touches two seam projects; blocked to be safe';

describe('literalPrefix: the text before the first wildcard, up to its last separator', () => {
  test.each([
    ['C:/proj/tests/**/*.ts', 'C:/proj/tests/'],
    ['C:\\proj\\tests\\**\\*.ts', 'C:\\proj\\tests\\'],
    ['/proj/src/foo*.ts', '/proj/src/'],
    ['C:/proj/{a,b}/x.ts', 'C:/proj/'],
    ['C:/proj/a?/x.ts', 'C:/proj/'],
    ['C:/proj/[ab]/x.ts', 'C:/proj/'],
    ['C:/**', 'C:/'],
    ['/**', '/'],
    ['C:/proj/notes.md', 'C:/proj/notes.md'],
    ['/proj/a/b', '/proj/a/b'],
    ['**/*.ts', ''],
    ['*', ''],
  ])('%s is %s', (pattern, prefix) => expect(literalPrefix(pattern)).toBe(prefix));
});

describe('filterOf: the field of the call that narrows a search to files', () => {
  test('a Glob\'s pattern and a Grep\'s glob', () => {
    expect(filterOf(input('Glob', { pattern: '*.ts' }))).toBe('*.ts');
    expect(filterOf(input('Grep', { pattern: 'needle', glob: '*.md' }))).toBe('*.md');
  });
  test('a Grep\'s pattern is text to find, not a path', () => expect(filterOf(input('Grep', { pattern: 'C:/proj/**' }))).toBeUndefined());
  test('no field, an empty one and a number are no filter', () => {
    expect(filterOf(input('Glob', {}))).toBeUndefined();
    expect(filterOf(input('Glob', { pattern: '' }))).toBeUndefined();
    expect(filterOf(input('Glob', { pattern: 7 }))).toBeUndefined();
  });
  test('only a search has one', () => {
    expect(filterOf(input('Read', { pattern: '*.ts' }))).toBeUndefined();
    expect(filterOf(input('Write', { glob: '*.ts' }))).toBeUndefined();
  });
});

describe('targetsOf adds the absolute prefix of a Glob pattern and of a Grep glob', () => {
  test('a Glob pattern with a drive path', () => {
    expect(targetsOf(input('Glob', { pattern: 'C:/proj/tests/**/*.ts' }))).toContain('C:/proj/tests/');
  });
  test('a Glob pattern from the root, and one with backslashes', () => {
    expect(targetsOf(input('Glob', { pattern: '/proj/src/**' }))).toContain('/proj/src/');
    expect(targetsOf(input('Glob', { pattern: 'D:\\proj\\**' }))).toContain('D:\\proj\\');
  });
  test('MSYS, Cygwin and WSL spellings are read as drive paths too (R20)', () => {
    for (const written of ['/c/proj/tests/**', '/cygdrive/c/proj/tests/**', '/mnt/c/proj/tests/**']) {
      expect(targetsOf(input('Glob', { pattern: written })), written).toContain('C:/proj/tests/');
    }
  });
  test('~ is the home folder', () => expect(targetsOf(input('Glob', { pattern: '~/proj/**' }))).toContain(join(homedir(), 'proj/')));
  test('a Grep glob does the same, with its path alongside', () => {
    const found = targetsOf(input('Grep', { pattern: 'x', path: 'C:/one', glob: 'C:/two/**/*.ts' }));
    expect(found).toContain('C:/one');
    expect(found).toContain('C:/two/');
  });
  test('a pattern with no wildcard is a path itself', () => expect(targetsOf(input('Glob', { pattern: 'C:/proj/notes.md' }))).toContain('C:/proj/notes.md'));
  test('a relative pattern, or a Grep\'s regex, adds nothing', () => {
    expect(targetsOf(input('Glob', { pattern: '**/*.ts' }))).toEqual([]);
    expect(targetsOf(input('Glob', { pattern: 'src/**/*.ts', path: 'C:/one' }))).toEqual(['C:/one']);
    expect(targetsOf(input('Grep', { pattern: 'C:/proj/**' }))).toEqual([]);
  });
  test('a tool that is not a search never has one', () => expect(targetsOf(input('Read', { file_path: 'a.ts', pattern: 'C:/proj/**' }))).toEqual(['a.ts']));
});

describe('R21: a Glob whose absolute pattern is in a seam project is that project\'s, from a folder that is not one', () => {
  test('the cheap check and the full lookup both see it', async () => {
    const app = await makeApp({ phase: 'build' });
    for (const [tool, field] of [['Glob', 'pattern'], ['Grep', 'glob']] as const) {
      const named = input(tool, { pattern: 'x', [field]: `${app.root.replace(/\\/g, '/')}/**/*.ts` }, tempDir());
      expect(whySeamPossible(named, tempDir()), `${tool}: the cheap check missed it`).toMatch(/holds/);
      expect(resolveProject(named, tempDir()), `${tool}: the full lookup missed it`).toMatchObject({ kind: 'seam', root: resolveReal(app.root, '.') });
    }
  });

  test('nothing in the call names a project, so it is left alone', () => {
    expect(whySeamPossible(input('Glob', { pattern: `${tempDir().replace(/\\/g, '/')}/**` }, tempDir()), tempDir())).toBeNull();
  });

  test('the hook checks in at that project, and for the main AI it is allowed', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, pre('Glob', { pattern: `${app.root.replace(/\\/g, '/')}/**/*.ts` }), { cwd: tempDir() });
    expect(out).toMatchObject({ stdout: '', exitCode: 0 });
    expect(heartbeatSeen(app.root)).toBe(true);
  });

  test('a builder\'s Glob of its tests by absolute pattern, from outside the project, is refused by that project', async () => {
    const app = await makeApp({ phase: 'build', turn: { file: TOTAL, agentId: 'builder-1' } });
    const glob = pre('Glob', { pattern: `${app.root.replace(/\\/g, '/')}/tests/**/*.ts` }, asBuilder('builder-1'));
    expect(reasonOf(await call(app, glob, { cwd: tempDir() }))).toBe(TESTS);
    expect(blocksOf(app)).toBe(1);
  });

  test('so is the real bundled hook', async () => {
    const app = await makeApp({ phase: 'build', turn: { file: TOTAL, agentId: 'builder-1' } });
    const glob = pre('Glob', { pattern: `${app.root.replace(/\\/g, '/')}/tests/**/*.ts` }, asBuilder('builder-1'));
    expectDenied(await app.hook(glob, { cwd: tempDir() }), /builders don't read tests/);
    const grep = pre('Grep', { pattern: 'x', glob: `${app.root.replace(/\\/g, '/')}/tests/*.ts` }, asBuilder('builder-1'));
    expectDenied(await app.hook(grep, { cwd: tempDir() }), /builders don't read tests/);
  });

  test('a session in one seam project and an absolute pattern in another is two projects', async () => {
    const a = await makeApp({ phase: 'build' });
    const b = await makeApp({ phase: 'build' });
    registerProject(b.root, a.dataDir);
    expect(reasonOf(await call(a, pre('Glob', { pattern: `${b.root.replace(/\\/g, '/')}/**/*.ts` })))).toBe(TWO);
  });
});
