// Which project a call belongs to (R21: the session's folder and the file it names are both asked,
// and the stricter answer wins), and the paths the guard refuses before it looks at them (R25, and
// network paths it cannot check).
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { extendedPathProblem } from '../../src/lib/pathcheck.ts';
import { registerProject } from '../../src/lib/paths.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectPlain, pre, write } from '../helpers/calls.ts';
import { blocksOf, call, heartbeatSeen, logOf, reasonOf } from '../helpers/inproc.ts';
import { tempDir } from '../helpers/project.ts';

const SILENT = { stdout: '', exitCode: 0 };
const MISSING = /records \(\.seam\) are missing/;
const TWO = 'this action touches two seam projects; blocked to be safe';

/** A second seam project, and the list of projects the first one's hook reads also knows it. */
async function twoApps(): Promise<{ a: App; b: App }> {
  const a = await makeApp({ phase: 'build' });
  const b = await makeApp({ phase: 'build' });
  registerProject(b.root, a.dataDir);
  return { a, b };
}

/** A project that was a seam project and has lost its records. */
async function goneApp(dataDir: string): Promise<App> {
  const gone = await makeApp({ phase: 'build' });
  registerProject(gone.root, dataDir);
  rmSync(join(gone.root, '.seam'), { recursive: true, force: true });
  return gone;
}

describe('the project is found from the session folder and from the file the call names (R21)', () => {
  test('a session outside any project, a file inside one: that project is the one (it checks in)', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(await call(app, write(app, 'src/new.ts', 'x'), { cwd: tempDir() })).toEqual(SILENT);
    expect(heartbeatSeen(app.root)).toBe(true);
  });

  test('Glob and Grep name a folder in `path`, and that is looked at too (the project folder itself counts)', async () => {
    const app = await makeApp({ phase: 'build' });
    await call(app, pre('Glob', { pattern: '*.ts', path: app.root }), { cwd: tempDir() });
    expect(heartbeatSeen(app.root)).toBe(true);
  });

  test('NotebookEdit names its file in notebook_path, and that is looked at too', async () => {
    const app = await makeApp({ phase: 'build' });
    await call(app, pre('NotebookEdit', { notebook_path: app.abs('a.ipynb') }), { cwd: tempDir() });
    expect(heartbeatSeen(app.root)).toBe(true);
  });

  test('a session in a project and a file outside every project: the project is used', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(await call(app, pre('Read', { file_path: join(tempDir(), 'x.txt') }))).toEqual(SILENT);
    expect(heartbeatSeen(app.root)).toBe(true);
  });

  test('a relative path is taken from the session folder', async () => {
    const { a, b } = await twoApps();
    // From inside project a, "../<b>/src/x.ts" is in project b: two projects.
    const there = relative(a.root, b.abs('src/x.ts'));
    expect(reasonOf(await call(a, pre('Read', { file_path: there })))).toBe(TWO);
  });

  test('a session in one seam project and a file in another is refused, counted in the session project only', async () => {
    const { a, b } = await twoApps();
    const out = await call(a, write(b, 'src/x.ts', 'x'));
    expect(reasonOf(out)).toBe(TWO);
    expect(blocksOf(a)).toBe(1);
    expect(blocksOf(b)).toBe(0);
    expect(logOf(a.root)).toMatch(/Blocked: main tried Write on .*x\.ts: this action touches two seam projects/);
  });

  test('two files in two projects, from a session outside both, is refused too', async () => {
    const { a, b } = await twoApps();
    const both = { ...pre('Grep', { pattern: 'x', path: a.root }), tool_input: { pattern: 'x', path: a.root, file_path: b.abs('f.ts') } };
    expect(reasonOf(await call(a, both, { cwd: tempDir() }))).toBe(TWO);
  });

  test('two paths that are in the same project are fine', async () => {
    const app = await makeApp({ phase: 'build' });
    const input = { ...pre('Grep', {}), tool_input: { pattern: 'x', path: app.abs('src'), file_path: app.abs('src/a.ts') } };
    expect(await call(app, input, { cwd: tempDir() })).toEqual(SILENT);
  });

  test('a project that lost its records beats a seam project: from the session folder', async () => {
    const app = await makeApp({ phase: 'build' });
    const gone = await goneApp(app.dataDir);
    expect(reasonOf(await call(app, write(app, 'src/new.ts', 'x'), { cwd: gone.root }))).toMatch(MISSING);
  });

  test('a project that lost its records beats a seam project: from the file the call names', async () => {
    const app = await makeApp({ phase: 'build' });
    const gone = await goneApp(app.dataDir);
    expect(reasonOf(await call(app, write(gone, 'src/new.ts', 'x')))).toMatch(MISSING);
    expect(blocksOf(app), 'there are no records to count it in, and the live project is not blamed').toBe(0);
  });

  test('a project that lost its records is found from a session folder that is not a project', async () => {
    const app = await makeApp({ phase: 'build' });
    const gone = await goneApp(app.dataDir);
    expect(reasonOf(await call(app, write(gone, 'src/new.ts', 'x'), { cwd: tempDir() }))).toMatch(MISSING);
  });

  test('no project anywhere is silence, and nothing is written', async () => {
    const app = await makeApp({ phase: 'build' });
    const nowhere = tempDir();
    expect(await call(app, pre('Write', { file_path: join(nowhere, 'a.ts'), content: 'x' }), { cwd: nowhere })).toEqual(SILENT);
    expect(await call(app, pre('Read', { file_path: join(tempDir(), 'a.ts') }), { cwd: nowhere })).toEqual(SILENT);
    expect(heartbeatSeen(app.root)).toBe(false);
  });
});

describe('extendedPathProblem (R25)', () => {
  test.each([
    String.raw`\\?\C:\app\src.\a.ts`, String.raw`\\?\C:\app\src\a.ts.`, String.raw`\\?\C:\app\src \a.ts`, String.raw`\\?\C:\app\a.ts `,
    '//?/C:/app/src./a.ts', String.raw`\\?/C:\app\src.\a.ts`, String.raw`\\?\C:\app\..\.seam\state.json`, String.raw`\\?\C:\app\.\a.ts`,
    String.raw`\\.\C:\app.\a.ts`, String.raw`\\?\UNC\host\share\a.ts.`, String.raw`\\?\C:\app\a.ts:stream.`,
  ])('%s is refused', (path) => {
    expect(extendedPathProblem(path)).toMatch(/ends in a dot or a space/);
  });

  test.each([
    String.raw`\\?\C:\app\src\a.ts`, '//?/C:/app/src/a.ts', String.raw`\\?\C:\app\.hidden\a.ts`, String.raw`\\?\C:\app\...x\a.ts`,
    '\\\\?\\C:\\', String.raw`\\?\C:`, String.raw`C:\app\src.\a.ts`, 'src/a.ts.', String.raw`\\host\share\a.ts.`, '',
  ])('%s is not this check\'s business', (path) => {
    expect(extendedPathProblem(path)).toBeNull();
  });
});

describe('a path like that in a call to a seam project (R25)', () => {
  test.each([
    (root: string) => `\\\\?\\${root}\\src\\bad.\\x.ts`,
    (root: string) => `//?/${root.replace(/\\/g, '/')}/src/x.ts `,
    (root: string) => `\\\\?\\${root}\\src\\..\\.seam\\state.json`,
  ])('is refused in plain words, before any rule, and counted', async (spell) => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, pre('Write', { file_path: spell(app.root), content: 'x' }));
    const reason = reasonOf(out);
    expect(reason).toMatch(/ends in a dot or a space/);
    expect(reason, 'a rule is not the guard failing').not.toMatch(/blocked to be safe|internal error/);
    expectPlain(reason);
    expect(blocksOf(app)).toBe(1);
  });

  test('the same path with no odd ending is not refused for its spelling', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(await call(app, pre('Write', { file_path: `\\\\?\\${app.root}\\src\\x.ts`, content: 'x' }))).toEqual(SILENT);
  });

  test('from a folder that is not a seam project it is none of the guard business', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, pre('Write', { file_path: `\\\\?\\${tempDir()}\\bad.\\x.ts`, content: 'x' }), { cwd: tempDir() });
    expect(out).toEqual(SILENT);
  });
});

// A network path is only meaningful to Windows, so the path code only refuses it there.
describe.skipIf(process.platform !== 'win32')('a network or device path the guard cannot check', () => {
  test.each([String.raw`\\evil-host\share\x.ts`, String.raw`\\?\GLOBALROOT\Device\x`, String.raw`\\?\UNC\\host\share\x`])(
    '%s from a seam project is refused as what it is, not as an internal error, and counted',
    async (path) => {
      const app = await makeApp({ phase: 'build' });
      const reason = reasonOf(await call(app, pre('Read', { file_path: path })));
      expect(reason).toMatch(/cannot be checked, so it is refused/);
      expect(reason).not.toMatch(/internal error|blocked to be safe/);
      expectPlain(reason);
      expect(blocksOf(app)).toBe(1);
      expect(logOf(app.root)).toMatch(/cannot be checked, so it is refused/);
    },
  );

  test('from a folder that is not a seam project the guard stays out of it', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, pre('Read', { file_path: String.raw`\\evil-host\share\x.ts` }), { cwd: tempDir() });
    expect(out).toMatchObject(SILENT);
    expect(out.note, 'the cause is said on stderr').toMatch(/cannot be checked, so it is refused/);
  });
});
