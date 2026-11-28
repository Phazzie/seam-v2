// The owner's honest flows, from start to finish (R77), with the keyboard and the launcher stubbed and everything else real: the
// real hook, the real `seam` command, the real window. A run is halted, the owner looks, edits a protected file by hand, and carries
// on from the Seam Approve window, and the next call finds nothing wrong (before, the guard put the owner's edit back and halted again,
// blaming the main AI, and the AI could not even run `seam report` to say what had happened).
import { describe, expect, test } from 'vitest';
import { windowCommand } from '../../src/cli/window.ts';
import { loadLock } from '../../src/formats/lock.ts';
import { loadState } from '../../src/formats/state.ts';
import { hash } from '../../src/lib/fingerprint.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, expectBlocked, expectDenied, post, run } from '../helpers/calls.ts';
import { PLAN_TEXT } from '../helpers/code.ts';
import { folderOf, shownCode, window as owner } from '../helpers/cli.ts';
import { ctxOf, logText } from '../helpers/tamper.ts';

const TESTFILE = 'tests/a.test.ts';
const ONE = 'export const a = 1;\n';
const TWO = 'export const a = 2;\n';
const bash = (command = 'git status') => post('Bash', { command });

/** A built project whose main AI has just changed a protected file through a command: put back, and the run halted. */
async function haltedByTheMainAI(): Promise<App> {
  const app = await makeApp({ phase: 'build', lock: true, files: { [TESTFILE]: ONE } });
  app.writeRaw('plan/plan.json', `${PLAN_TEXT}\n`);
  expectBlocked(await app.hook(bash('echo > plan/plan.json')), /plan\/plan\.json was changed outside the rules and has been put back/);
  expect(loadState(app.root)?.halted).toBe('the main AI changed a protected file: plan/plan.json');
  expect(app.read('plan/plan.json')).toBe(PLAN_TEXT);
  return app;
}
const open = async (app: App, typed: Parameters<typeof owner>[0]) => {
  const w = owner(typed);
  const code = await windowCommand(w.io, () => ctxOf(app), () => ({ root: app.root, dataDir: app.dataDir }));
  return { code, said: w.said.join('\n') };
};
const carriesOn = async (app: App): Promise<void> => {
  expect(loadState(app.root)?.halted).toBeNull();
  expectAllowed(await app.hook(run('Bash', 'git status')));
  const r = await app.hook(bash());
  expectAllowed(r);
  expect(r.stdout, 'the tamper check had something to say').toBe('');
};

describe('a halted run, from the AI\'s side', () => {
  test('it can say what happened (seam report) and ask the owner (seam request park or edit), and nothing else', async () => {
    const app = await haltedByTheMainAI();
    expectAllowed(await app.hook(run('Bash', 'seam report')));
    const report = await folderOf(app).cli(['report']);
    expect(report.exitCode, report.stderr).toBe(0);
    expect(report.stdout).toMatch(/STOPPED: the main AI changed a protected file: plan\/plan\.json/);
    expect(report.stdout).toMatch(/Open the Seam Approve window on your desktop to look at it and carry on\./);
    expectAllowed(await app.hook(run('Bash', 'seam request edit')));
    expect((await folderOf(app).cli(['request', 'edit'])).exitCode).toBe(0);
    expectAllowed(await app.hook(bash('seam request edit'))); // what the harness sends after the command ran: the request is in the record
    expectDenied(await app.hook(run('Bash', 'git status')), /The run is halted: .*Seam Approve window on your desktop/);
    expect(loadState(app.root)?.halted).not.toBeNull();
  });
});

describe('the owner carries on from the window', () => {
  test('the AI asks for an edit, the owner changes a protected file, opens the window, and approves: the edit is kept and the run goes on', async () => {
    const app = await haltedByTheMainAI();
    expect((await folderOf(app).cli(['request', 'edit'])).exitCode).toBe(0);
    app.writeRaw(TESTFILE, TWO); // the owner's own change, by hand
    const { code, said } = await open(app, [shownCode]);
    expect(code).toBe(0);
    expect(said).toMatch(/Make your changes to the protected files first/);
    expect(said).toContain(`- ${TESTFILE} (changed)`);
    expect(said).toMatch(/Approved edit/);
    expect(loadLock(app.root)!.files[TESTFILE]).toEqual({ kind: 'whole', hash: hash(TWO) });
    expect(logText(app)).toMatch(/Owner approved edit\n/);
    expect(logText(app)).toMatch(/Owner accepted their own edits to: tests\/a\.test\.ts/);
    await carriesOn(app);
    expect(app.read(TESTFILE)).toBe(TWO);
  });

  test('with no request at all, the owner opens the window, chooses "accept my own edits", and the run goes on', async () => {
    const app = await haltedByTheMainAI();
    app.writeRaw(TESTFILE, TWO);
    const { said } = await open(app, ['2', shownCode, '4']);
    expect(said).toContain(`- ${TESTFILE} (changed)`);
    expect(said).toMatch(/Done: 1 file accepted/);
    await carriesOn(app);
    expect(app.read(TESTFILE)).toBe(TWO);
  });

  test('a park approval clears the stop too, and does not touch a file the owner changed (that is what "edit" is for)', async () => {
    const app = await haltedByTheMainAI();
    expect((await folderOf(app).cli(['request', 'park'])).exitCode).toBe(0);
    const { said } = await open(app, [shownCode]);
    expect(said).toMatch(/Approved park/);
    await carriesOn(app);
  });

  test('the edit has to be approved before the AI\'s next step ends, or the guard puts it back (as it must for anyone else), and the owner is told so', async () => {
    const app = await haltedByTheMainAI();
    expect((await folderOf(app).cli(['request', 'edit'])).exitCode).toBe(0);
    expect(JSON.parse(app.read('.seam/pending.json')).summary).toMatch(/before Claude runs anything else/);
    app.writeRaw(TESTFILE, TWO);
    expectBlocked(await app.hook(bash()), /tests\/a\.test\.ts was changed outside the rules and has been put back/);
    expect(app.read(TESTFILE)).toBe(ONE);
    const { said } = await open(app, [shownCode]);
    expect(said).toMatch(/No protected file differs/);
    await carriesOn(app);
  });
});
