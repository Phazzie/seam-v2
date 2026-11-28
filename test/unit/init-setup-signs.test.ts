// R83 (Codex on PR #25): `seam init` on a project judged its setup whole by the data folder being there. After the data folder is lost, the
// next refused call (a hook's refusal writes the state's copy, `writeState`) makes the folder again, empty, and init then said the folder was
// a seam project already, while `seam report` had told the owner to run init. The setup is judged by what is left of it: the project's
// line in the project list kept in the data folder, and its launcher where it has a desktop shortcut. A data folder that is only there
// again, empty, is not a whole setup.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { installShortcut } from '../../src/cli/shortcut.ts';
import { scriptPathFor } from '../../src/cli/shortcutnames.ts';
import { makeApp } from '../helpers/app.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { folderOf } from '../helpers/cli.ts';
import { tempDir } from '../helpers/project.ts';

const WINDOWS = process.platform === 'win32';
const bash = post('Bash', { command: 'git status' });
const WHOLE = /setup was incomplete and is whole again/;
const listed = (dataDir: string): string[] => (JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')) as { projects: string[] }).projects;

describe('a lost data folder that a hook has made again', () => {
  test('the refused call makes the folder again, empty; init still says the setup was incomplete, and makes it whole', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const desktop = tempDir();
    rmSync(app.dataDir, { recursive: true, force: true });
    const r = await app.hook(bash); // the guard has no record of the protected files, so it refuses, and writes the state's copy
    expect(r.denied || r.stdout !== '', 'the call was not refused').toBe(true);
    expect(existsSync(app.dataDir), 'the refusal did not make the data folder again').toBe(true);
    expect(existsSync(join(app.dataDir, 'projects.json'))).toBe(false);
    const init = await folderOf(app).cli(['init'], { SEAM_DESKTOP_DIR: desktop });
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(init.stdout).toMatch(WHOLE);
    expect(listed(app.dataDir).length).toBe(1);
  });

  test('so is a data folder that is whole except for the project list (the guard looks the project up there when state.json is gone)', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    rmSync(join(app.dataDir, 'projects.json'));
    const init = await folderOf(app).cli(['init'], { SEAM_DESKTOP_DIR: tempDir() });
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(init.stdout).toMatch(WHOLE);
    expect(listed(app.dataDir).length).toBe(1);
  });

  test('a whole setup is still "a seam project already", and nothing is touched', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const state = app.read('.seam/state.json');
    const init = await folderOf(app).cli(['init'], { SEAM_DESKTOP_DIR: tempDir() });
    expect(init.exitCode).toBe(1);
    expect(init.stderr).toMatch(/is a seam project already/);
    expect(app.read('.seam/state.json')).toBe(state);
    expectAllowed(await app.hook(bash));
  });
});

describe.skipIf(!WINDOWS)('the launcher, where the project has a desktop shortcut', () => {
  test('a shortcut and no launcher (the data folder is there, and lists the project) is an incomplete setup: init writes the launcher again', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const desktop = tempDir();
    const made = installShortcut({ root: app.root, dataDir: app.dataDir, pluginRoot: app.pluginRoot, desktopDir: desktop });
    rmSync(made.script);
    const init = await folderOf(app).cli(['init'], { SEAM_DESKTOP_DIR: desktop });
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(init.stdout).toMatch(WHOLE);
    expect(init.stdout).toMatch(/shortcut on your desktop works again/);
    expect(existsSync(made.script)).toBe(true);
    expect(made.script).toBe(scriptPathFor(app.dataDir, app.root));
  });

  test('a shortcut and its launcher: whole, as before', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const desktop = tempDir();
    installShortcut({ root: app.root, dataDir: app.dataDir, pluginRoot: app.pluginRoot, desktopDir: desktop });
    const init = await folderOf(app).cli(['init'], { SEAM_DESKTOP_DIR: desktop });
    expect(init.exitCode).toBe(1);
    expect(init.stderr).toMatch(/is a seam project already/);
  });

  test('no shortcut and no launcher: whole too (the owner has not asked for one)', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const init = await folderOf(app).cli(['init'], { SEAM_DESKTOP_DIR: tempDir() });
    expect(init.exitCode).toBe(1);
    expect(init.stderr).toMatch(/is a seam project already/);
  });
});
