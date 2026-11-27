// R41: a command run from a folder that is not a seam project, which changes into one or names a path in one, is
// that project's call. The hook's full lookup (project.ts) and the worker's cheap check (inert.ts) both read the
// command's paths through the shared targetsOf, so neither lets such a command through as "not a seam project".
// The last cases run the real bundle, where the cheap check is the first thing that runs.
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { whySeamPossible } from '../../src/guard/inert.ts';
import { resolveProject } from '../../src/guard/project.ts';
import { registerProject } from '../../src/lib/paths.ts';
import { makeApp } from '../helpers/app.ts';
import { expectAllowed, expectDenied, run } from '../helpers/calls.ts';
import { blocksOf, call, heartbeatSeen, logOf, reasonOf } from '../helpers/inproc.ts';
import { tempDir } from '../helpers/project.ts';

const WIN = process.platform === 'win32';
const SILENT = { stdout: '', exitCode: 0 };
const bash = (cwd: string, command: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command } });
/** `C:\a\b` as `/c/a/b`. */
const unixy = (abs: string): string => `/${abs[0].toLowerCase()}${abs.slice(2).replace(/\\/g, '/')}`;

describe('the full lookup and the cheap check both find the project a command names', () => {
  test.each([
    ['changes into it', (root: string) => `cd ${root}`],
    ['changes into it with Set-Location', (root: string) => `Set-Location -Path ${root}`],
    ['changes into it, quoted', (root: string) => `cd "${root}"`],
    ['changes into it, then does more', (root: string) => `cd ${root}; Remove-Item .seam -Recurse -Force`],
    ['names a file in it', (root: string) => `git diff ${join(root, 'src', 'a.ts')}`],
    ['names it in an option', (root: string) => `git -C ${root} status`],
    ['writes into it by redirection', (root: string) => `echo x > ${join(root, 'notes.md')}`],
    ['changes into it from inside a quoted subshell', (root: string) => `echo "$(cd ${root})"`],
    ['changes into it by a relative name', (root: string) => `cd ${basename(root)}`],
  ])('%s', async (_what, command) => {
    const app = await makeApp({ phase: 'build' });
    const cwd = dirname(app.root);
    const input = bash(cwd, command(app.root));
    expect(whySeamPossible(input, tempDir()), 'the cheap check missed it').toMatch(/holds/);
    expect(resolveProject(input, tempDir()), 'the full lookup missed it').toMatchObject({ kind: 'seam' });
  });

  test.runIf(WIN).each(['/', '/cygdrive/', '/mnt/'])('by its %s drive form (R20)', async (prefix) => {
    const app = await makeApp({ phase: 'build' });
    const form = unixy(app.root).replace(/^\//, prefix);
    const input = bash(tempDir(), `cd ${form}`);
    expect(whySeamPossible(input, tempDir())).toMatch(/holds/);
    expect(resolveProject(input, tempDir())).toMatchObject({ kind: 'seam' });
  });

  test('a command that names nothing in a seam project is not one (and the cheap check says so)', async () => {
    const app = await makeApp({ phase: 'build' });
    for (const command of ['git status', 'npm test', 'cd /nowhere/at/all', `git diff ${join(tempDir(), 'a.ts')}`, 'curl https://example.com/a/b']) {
      expect(whySeamPossible(bash(tempDir(), command), app.dataDir), command).toBeNull();
      expect(resolveProject(bash(tempDir(), command), app.dataDir), command).toMatchObject({ kind: 'none' });
    }
  });
});

describe('a command from a folder that is not a seam project is judged by the project it names', () => {
  test('cd into the project, then something else: refused for chaining, counted in the project, and it checked in', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, run('PowerShell', `cd ${app.root}; Remove-Item .seam -Recurse -Force`), { cwd: tempDir() });
    expect(reasonOf(out)).toMatch(/^one simple command at a time, please/);
    expect(blocksOf(app)).toBe(1);
    expect(heartbeatSeen(app.root)).toBe(true);
    expect(logOf(app.root)).toMatch(/Blocked: main tried PowerShell "cd .*Remove-Item/);
  });

  test('just the cd: it is not on the list, so it is refused too', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, run('Bash', `cd ${app.root}`), { cwd: tempDir() });
    expect(reasonOf(out)).toMatch(/^'cd' isn't on seam's command list/);
    expect(blocksOf(app)).toBe(1);
  });

  test('a command on the list that names a file in the project is let through, and the project is checked in', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(await call(app, run('Bash', `git diff ${join(app.root, 'src', 'a.ts')}`), { cwd: tempDir() })).toEqual(SILENT);
    expect(heartbeatSeen(app.root)).toBe(true);
  });

  test('a command that is not on the list, naming a protected file in the project from outside it, is refused for it', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, run('Bash', `rm ${join(app.root, '.seam', 'state.json')}`), { cwd: tempDir() });
    expect(reasonOf(out)).toMatch(/records/);
    expect(blocksOf(app)).toBe(1);
  });

  test.runIf(WIN)('by an MSYS drive form: refused, and counted in the project', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, run('Bash', `rm -rf ${unixy(app.root)}/.seam`), { cwd: tempDir() });
    expect(reasonOf(out)).toMatch(/records/);
    expect(blocksOf(app)).toBe(1);
  });

  test('a command that names nothing in a project is left alone, and the project is not checked in', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(await call(app, run('Bash', 'rm -rf somewhere/else'), { cwd: tempDir() })).toEqual(SILENT);
    expect(heartbeatSeen(app.root)).toBe(false);
  });

  test('one command that names two projects is refused', async () => {
    const a = await makeApp({ phase: 'build' });
    const b = await makeApp({ phase: 'build' });
    registerProject(b.root, a.dataDir);
    const out = await call(a, run('Bash', `git diff ${join(a.root, 'x.ts')} ${join(b.root, 'y.ts')}`), { cwd: tempDir() });
    expect(reasonOf(out)).toBe('this action touches two seam projects; blocked to be safe');
  });
});

describe('the real hook, where the cheap check runs first', () => {
  test('a command that changes into a seam project from outside it is refused', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(run('PowerShell', `cd ${app.root}; Remove-Item .seam -Recurse -Force`), { cwd: tempDir() });
    expectDenied(r, /one simple command at a time/);
  });
  test('a command that names nothing in a project is allowed from outside one', async () => {
    const app = await makeApp({ phase: 'build' });
    expectAllowed(await app.hook(run('Bash', 'rm -rf somewhere/else'), { cwd: tempDir() }));
  });
  test('inside a project a plain command on the list is allowed', async () => {
    const app = await makeApp({ phase: 'build' });
    expectAllowed(await app.hook(run('Bash', 'git status')));
  });
});
