// `seam window` (R77): the Seam Approve window is the owner's one place. Opened from the shortcut (here: a stand-in for the keyboard
// and for the launcher), it approves a waiting request, or shows a short menu: the report, accept my own edits, repair, close.
import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { requestApproval } from '../../src/cli/request.ts';
import { windowCommand } from '../../src/cli/window.ts';
import { loadLock } from '../../src/formats/lock.ts';
import { fingerprintCode, hash } from '../../src/lib/fingerprint.ts';
import { updateState } from '../../src/lib/store.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, expectDenied, post, run } from '../helpers/calls.ts';
import { PLAN_TEXT, TOTAL, total } from '../helpers/code.ts';
import { shownCode, window as owner } from '../helpers/cli.ts';
import { PENDING, appIn, codeOf, stateOf } from '../helpers/approving.ts';
import { ctxOf, logText } from '../helpers/tamper.ts';

const THE_WINDOW = 'approvals happen in the Seam Approve window on your desktop';
const TESTFILE = 'tests/a.test.ts';
const ONE = 'export const a = 1;\n';
const TWO = 'export const a = 2;\n';
const NEW_TOTAL = total({ params: 'a: number, b: number, c = 0' });
const home = (app: App) => () => ({ root: app.root, dataDir: app.dataDir });

/** Open the window on `app`, typing `typed` one line for each question. */
async function open(app: App, typed: Parameters<typeof owner>[0]) {
  const w = owner(typed);
  const code = await windowCommand(w.io, () => ctxOf(app), home(app));
  return { code, w, said: w.said.join('\n') };
}
/** A built project with a test file, stopped because "the main AI changed a protected file". */
async function stoppedApp(): Promise<App> {
  const app = await makeApp({ phase: 'build', lock: true, files: { [TESTFILE]: ONE } });
  updateState(app.root, app.dataDir, (s) => ({ ...s, halted: 'the main AI changed a protected file: plan/plan.json' }));
  return app;
}
const clean = async (app: App): Promise<void> => {
  const r = await app.hook(post('Bash', { command: 'git status' }));
  expectAllowed(r);
  expect(r.stdout, 'the tamper check had something to say').toBe('');
};

describe('who may open the window', () => {
  test.each([
    ['stdin is not a terminal', { stdinTty: false }],
    ['stdout is not a terminal', { stdoutTty: false }],
    ['it was not opened from the shortcut', { byShortcut: () => false }],
  ])('refused when %s: the window message, nothing asked, the project not even read', async (_why, opts) => {
    const w = owner(['4'], opts);
    expect(await windowCommand(w.io, () => { throw new Error('read the project'); }, () => { throw new Error('looked for the project'); })).toBe(1);
    expect(w.said.join('\n')).toContain(THE_WINDOW);
    expect(w.asked).toEqual([]);
  });

  test('the AI cannot run it: seam window is not on the list of commands the guard lets it run', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    expectDenied(await app.hook(run('Bash', 'seam window')), /isn't on seam's command list|not one of the seam commands/);
  });
});

describe('a request is waiting', () => {
  test('a good one goes straight to approving, with no menu', async () => {
    const app = await appIn('tests');
    requestApproval(ctxOf(app), 'freeze');
    const { code, said, w } = await open(app, [codeOf(app)]);
    expect(code).toBe(0);
    expect(said).toMatch(/Approved freeze/);
    expect(said).not.toMatch(/1\) Show the report/);
    expect(w.asked).toHaveLength(1);
    expect(stateOf(app).phase).toBe('build');
  });

  test('one that has gone stale says why and falls back to the menu, so the owner is not stuck', async () => {
    const app = await appIn('tests');
    requestApproval(ctxOf(app), 'freeze');
    app.writeRaw(TOTAL, `${app.read(TOTAL)}// changed by hand\n`);
    const { code, said } = await open(app, ['4']);
    expect(code).toBe(0);
    expect(said).toMatch(/cannot be approved: things changed since this was requested/);
    expect(said).toMatch(/1\) Show the report/);
    expect(existsSync(app.abs(PENDING))).toBe(true);
    expect(stateOf(app).phase).toBe('tests');
  });
});

describe('the menu', () => {
  test('shows the four choices and closes on 4, changing nothing', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const before = stateOf(app);
    const { code, said } = await open(app, ['4']);
    expect(code).toBe(0);
    for (const choice of ['1) Show the report', '2) Accept my own edits to protected files', '3) Repair a broken record', '4) Close']) expect(said).toContain(choice);
    expect(stateOf(app)).toEqual(before);
  });

  test('1 shows the report; a choice that is not one asks again', async () => {
    const app = await stoppedApp();
    const { said, w } = await open(app, ['1', 'x', '', '4']);
    expect(said).toMatch(/Seam report/);
    expect(said).toMatch(/STOPPED: the main AI changed a protected file/);
    expect(said).toMatch(/Type 1, 2, 3 or 4\./);
    expect(w.asked).toHaveLength(4);
  });

  test('2 with nothing to accept and no stop says so, and asks for no code', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const { said, w } = await open(app, ['2', '4']);
    expect(said).toMatch(/nothing to accept/);
    expect(w.asked.filter((q) => /code/.test(q))).toEqual([]);
  });

  test('2 lists the files that differ, asks for a fresh code, takes the edits in (record and lock), clears the stop, and logs it', async () => {
    const app = await stoppedApp();
    app.writeRaw(TESTFILE, TWO);
    app.writeRaw(TOTAL, NEW_TOTAL);
    const { said, w } = await open(app, ['2', shownCode, '4']);
    expect(said).toContain(`- ${TESTFILE} (changed)`);
    expect(said).toContain(`- ${TOTAL} (changed)`);
    expect(w.asked.some((q) => /Type the code above to confirm/.test(q))).toBe(true);
    expect(said).toMatch(/Done: 2 files accepted/);
    expect(stateOf(app).halted).toBeNull();
    expect(stateOf(app).approvals).toMatchObject([{ kind: 'edit', summary: `The owner accepted their own edits to: ${[TOTAL, TESTFILE].sort().join(', ')}.` }]);
    expect(loadLock(app.root)!.files[TESTFILE]).toEqual({ kind: 'whole', hash: hash(TWO) });
    expect(loadLock(app.root)!.files[TOTAL]).toEqual(fingerprintCode(TOTAL, NEW_TOTAL));
    expect(logText(app)).toMatch(/\d\d:\d\d Owner accepted their own edits to: .*tests\/a\.test\.ts/);
    await clean(app);
    expect(app.read(TESTFILE)).toBe(TWO);
    expect(app.read(TOTAL)).toBe(NEW_TOTAL);
  });

  test('2 on a stopped run with nothing differing still lets it carry on, after the code', async () => {
    const app = await stoppedApp();
    const { said } = await open(app, ['2', shownCode, '4']);
    expect(said).toMatch(/The run is stopped .*accepting lets it carry on/);
    expect(stateOf(app).halted).toBeNull();
    expect(logText(app)).toMatch(/Owner let the stopped run carry on/);
  });

  test('2: three wrong tries accept nothing, and the owner\'s edit is still waiting', async () => {
    const app = await stoppedApp();
    app.writeRaw(TESTFILE, TWO);
    const { said } = await open(app, ['2', 'AAAA', 'BBBB', 'CCCC', '4']);
    expect(said).toMatch(/Three wrong tries, so nothing was accepted/);
    expect(stateOf(app).halted).not.toBeNull();
    expect(stateOf(app).approvals).toEqual([]);
    expect(loadLock(app.root)!.files[TESTFILE]).toEqual({ kind: 'whole', hash: hash(ONE) });
  });

  test('2: if the files change again while the owner decides, nothing is accepted', async () => {
    const app = await stoppedApp();
    app.writeRaw(TESTFILE, TWO);
    const { said } = await open(app, ['2', (screen) => { app.writeRaw(TESTFILE, 'export const a = 3;\n'); return shownCode(screen); }, '4']);
    expect(said).toMatch(/Things changed while you were deciding, so nothing was accepted/);
    expect(stateOf(app).halted).not.toBeNull();
    expect(loadLock(app.root)!.files[TESTFILE]).toEqual({ kind: 'whole', hash: hash(ONE) });
  });

  test('2 refuses a locked code file that no longer parses, before changing anything, and the window carries on', async () => {
    const app = await stoppedApp();
    app.writeRaw(TOTAL, 'export function total( {{{ \n');
    const { code, said } = await open(app, ['2', shownCode, '4']);
    expect(code).toBe(0);
    expect(said).toMatch(/src\/pricing\/total\.ts can't be accepted: .* Nothing was accepted\./);
    expect(stateOf(app).halted).not.toBeNull();
    expect(loadLock(app.root)!.files[TOTAL]).toMatchObject({ kind: 'code' });
  });

  test('3 repairs a record that cannot be read, even though nothing else works until then', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('plan/plan.json', 'garbage {');
    const { said } = await open(app, ['1', '3', '1', '4']);
    expect(said).toMatch(/plan\/plan\.json is unreadable.*Choose 3/s);
    expect(said).toMatch(/Choose 3 first/);
    expect(said).toMatch(/Put back plan\/plan\.json/);
    expect(said).toMatch(/Seam report/);
    expect(app.read('plan/plan.json')).toBe(PLAN_TEXT);
    await clean(app);
  });
});
