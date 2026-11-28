// R79: the ways back from a lost or damaged setup, through the Seam Approve window.
//  - The data folder was lost and `seam init` made the setup whole again, which says to choose "Accept my own edits" for a fresh record
//    of the protected files. With no record, menu 2 (and an `edit` approval) used to find nothing to accept and say so; it takes the fresh
//    record now (after the code), refreshes the lock for what differs from it, and clears a stop.
//  - "Choose 3" (repair) is said only when a record file is damaged, not when the setup is incomplete.
//  - A request that cannot be read is said so plainly, and can be cleared from the menu.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { approve } from '../../src/cli/approve.ts';
import { editFile } from '../../src/cli/edit.ts';
import { loadPending } from '../../src/cli/pending.ts';
import { renderReport } from '../../src/cli/report.ts';
import { loadCtx, whereAmI } from '../../src/cli/home.ts';
import { windowCommand } from '../../src/cli/window.ts';
import { loadLock } from '../../src/formats/lock.ts';
import { loadState } from '../../src/formats/state.ts';
import { hash } from '../../src/lib/fingerprint.ts';
import { rootKey, updateState } from '../../src/lib/store.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { folderAt, shownCode, window as owner } from '../helpers/cli.ts';
import type { Folder } from '../helpers/cli.ts';
import { tempDir } from '../helpers/project.ts';
import { ctxOf } from '../helpers/tamper.ts';

const FILE = 'tests/a.test.ts';
const NO_RECORD = 'The guard has no record yet; this takes a fresh record of every protected file as it is now';
const bash = post('Bash', { command: 'git status' });

/** A built, locked project whose data folder was lost and which `seam init` has made whole again: its setup is fine, its record is gone. */
async function lost(files: Record<string, string> = {}): Promise<{ app: App; folder: Folder; dataDir: string }> {
  const app = await makeApp({ phase: 'build', lock: true, files });
  rmSync(app.dataDir, { recursive: true, force: true });
  const dataDir = join(tempDir(), 'data');
  const folder = folderAt(app.root, dataDir, app.pluginRoot);
  const init = await folder.cli(['init']);
  expect(init.exitCode, init.stdout + init.stderr).toBe(0);
  return { app, folder, dataDir };
}
const recordFile = (app: App, dataDir: string): string => join(dataDir, 'mirror', rootKey(app.root), 'protected.json');
const open = async (folder: Folder, home: () => { root: string; dataDir: string }, typed: Parameters<typeof owner>[0]) => {
  const w = owner(typed);
  const code = await windowCommand(w.io, () => folder.ctx(), home);
  return { code, said: w.said.join('\n'), w };
};

describe('no record of the protected files (the data folder was lost)', () => {
  test('until the owner takes a fresh one, every check is refused: the record is missing', async () => {
    const { folder } = await lost();
    const r = await folder.hook(bash);
    expect(r.blocked, 'the check let it through').toBe(true);
    expect(r.reason).toMatch(/record of the protected files is missing/);
  });

  test('menu 2 says there is no record, asks for the code, takes a fresh record, and the next check is clean', async () => {
    const { app, folder, dataDir } = await lost();
    const { code, said } = await open(folder, () => ({ root: app.root, dataDir }), ['2', shownCode, '4']);
    expect(code).toBe(0);
    expect(said).toContain(NO_RECORD);
    expect(said).not.toMatch(/nothing to accept/);
    expect(said).toMatch(/Done: a fresh record was taken/);
    expect(existsSync(recordFile(app, dataDir))).toBe(true);
    const r = await folder.hook(bash);
    expectAllowed(r);
    expect(r.stdout, 'the tamper check had something to say').toBe('');
    expect(folder.read('.seam/log.md')).toMatch(/Owner took a fresh record of the protected files/);
    expect(loadState(app.root)?.approvals).toMatchObject([{ kind: 'edit', summary: 'The owner took a fresh record of the protected files.' }]);
  });

  test('it also clears a stop, and refreshes the lock for a locked file that differs from it', async () => {
    const { app, folder, dataDir } = await lost({ [FILE]: 'export const a = 1;\n' });
    updateState(app.root, dataDir, (s) => ({ ...s, halted: 'the main AI changed a protected file: plan/plan.json' }));
    app.writeRaw(FILE, 'export const a = 2;\n'); // the owner's change, made while the record was gone
    const { said } = await open(folder, () => ({ root: app.root, dataDir }), ['2', shownCode, '4']);
    expect(said).toContain(NO_RECORD);
    expect(said).toContain(`- ${FILE} (changed)`);
    expect(loadState(app.root)?.halted).toBeNull();
    expect(loadLock(app.root)!.files[FILE]).toEqual({ kind: 'whole', hash: hash('export const a = 2;\n') });
    expectAllowed(await folder.hook(bash));
    expect(app.read(FILE)).toBe('export const a = 2;\n');
  });

  test('three wrong codes take nothing', async () => {
    const { app, folder, dataDir } = await lost();
    const { said } = await open(folder, () => ({ root: app.root, dataDir }), ['2', 'AAAA', 'BBBB', 'CCCC', '4']);
    expect(said).toMatch(/Three wrong tries, so nothing was accepted/);
    expect(existsSync(recordFile(app, dataDir))).toBe(false);
  });

  test('an edit approval does the same, and its text says so', async () => {
    const { app, folder, dataDir } = await lost();
    expect((await folder.cli(['request', 'edit'])).exitCode).toBe(0);
    expect(loadPending(app.root)?.summary).toMatch(/no record of the protected files yet.*fresh one of every protected file/s);
    const w = owner([shownCode]);
    expect(await approve(w.io, () => folder.ctx())).toBe(0);
    expect(w.said.join('\n')).toContain(NO_RECORD);
    expect(existsSync(recordFile(app, dataDir))).toBe(true);
    expectAllowed(await folder.hook(bash));
  });

  test('with a record, nothing changes: no differences and no stop is still "nothing to accept"', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const w = owner(['2', '4']);
    await windowCommand(w.io, () => ctxOf(app), () => ({ root: app.root, dataDir: app.dataDir }));
    expect(w.said.join('\n')).toMatch(/nothing to accept/);
    expect(w.said.join('\n')).not.toContain(NO_RECORD);
  });
});

const HOPELESS = { dataDir: null, pluginData: null, pluginRoot: null, desktopDir: null };

describe('what the window says when it cannot read the project', () => {
  test('a damaged record points at repair (choice 3)', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('plan/plan.json', 'garbage {');
    const w = owner(['4']);
    await windowCommand(w.io, () => ctxOf(app), () => ({ root: app.root, dataDir: app.dataDir }));
    expect(w.said.join('\n')).toMatch(/plan\/plan\.json is unreadable.*Choose 3/s);
  });

  test.each([
    ['env.json is gone', (app: App) => rmSync(app.abs('.seam/env.json')), /setup is incomplete; run seam init again from Claude Code/],
    ['the data folder is gone', (app: App) => rmSync(app.dataDir, { recursive: true, force: true }), /no longer exists/],
  ])('an incomplete setup (%s) says to run seam init again, not to repair, and offers no menu', async (_what, damage, message) => {
    const app = await makeApp({ phase: 'build', lock: true });
    damage(app);
    const w = owner(['4']);
    const code = await windowCommand(w.io, () => loadCtx(whereAmI(app.root, HOPELESS, app.pluginRoot)), () => whereAmI(app.root, HOPELESS, app.pluginRoot));
    const said = w.said.join('\n');
    expect(code).toBe(1);
    expect(said).toMatch(message);
    expect(said).not.toMatch(/Choose 3|repair|SEAM_DATA_DIR/i);
    expect(said).not.toMatch(/1\) Show the report/);
    expect(w.asked).toEqual([]);
  });
});

describe('a request that cannot be read', () => {
  const malformed = async (): Promise<App> => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('.seam/pending.json', '{ nope');
    return app;
  };
  const home = (app: App) => () => ({ root: app.root, dataDir: app.dataDir });

  test('the window says so plainly, and falls back to the menu with a way to clear it', async () => {
    const app = await malformed();
    const w = owner(['4']);
    expect(await windowCommand(w.io, () => ctxOf(app), home(app))).toBe(0);
    const said = w.said.join('\n');
    expect(said).toMatch(/The request waiting for you cannot be read/);
    expect(said).toMatch(/5\) Clear the request that cannot be read/);
    expect(existsSync(app.abs('.seam/pending.json'))).toBe(true);
  });

  test('choosing 5 clears it, and the next menu no longer offers it', async () => {
    const app = await malformed();
    const w = owner(['5', '4']);
    await windowCommand(w.io, () => ctxOf(app), home(app));
    const said = w.said.join('\n');
    expect(said).toMatch(/Cleared the request that could not be read/);
    expect(existsSync(app.abs('.seam/pending.json'))).toBe(false);
    expect(said.match(/5\) Clear/g)).toHaveLength(1);
    expect(app.read('.seam/log.md')).toMatch(/Owner cleared a request that could not be read/);
    expectAllowed(await app.hook(bash));
  });

  test('a good request never shows the choice, and "5" is then not a choice', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const w = owner(['5', '4']);
    await windowCommand(w.io, () => ctxOf(app), home(app));
    expect(w.said.join('\n')).not.toMatch(/Clear the request/);
    expect(w.said.join('\n')).toMatch(/Type 1, 2, 3 or 4\./);
  });

  test('the report does not fail on it either: it says there is a request it cannot read', async () => {
    const app = await malformed();
    const text = renderReport(ctxOf(app), new Date());
    expect(text).toMatch(/A request is waiting, but it cannot be read/);
    expect(text).toMatch(/Seam Approve window/);
  });
});

describe('seam edit with an incomplete setup', () => {
  test('says to run seam init again, and does not point at seam repair', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    rmSync(app.abs('.seam/env.json'));
    const w = owner(['yes']);
    const code = await editFile(w.io, () => loadCtx(whereAmI(app.root, HOPELESS, app.pluginRoot)), FILE, app.root);
    expect(code).toBe(1);
    expect(w.said.join(' ')).toMatch(/setup is incomplete; run seam init again from Claude Code/);
    expect(w.said.join(' ')).not.toMatch(/repair/i);
    expect(w.asked).toEqual([]);
  });
});
