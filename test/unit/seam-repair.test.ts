// `seam repair` (Task 13): what only the owner may run to put back a plan.json, lock.json or state.json that cannot be read.
// It is not on the list of commands the AI may run: the guard refuses it as it refuses anything else that is not on it.
import { writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { repair } from '../../src/cli/repair.ts';
import { loadState } from '../../src/formats/state.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, expectDenied, post, run } from '../helpers/calls.ts';
import { PLAN_TEXT } from '../helpers/code.ts';
import { folderOf, window } from '../helpers/cli.ts';
import { logText } from '../helpers/tamper.ts';

const bash = post('Bash', { command: 'git status' });
const home = (app: App) => ({ root: app.root, dataDir: app.dataDir });
const clean = async (app: App): Promise<void> => {
  const r = await app.hook(bash);
  expectAllowed(r);
  expect(r.stdout, 'the tamper check had something to say').toBe('');
  expect(loadState(app.root)?.halted).toBeNull();
};

describe('seam repair', () => {
  test('a plan.json that cannot be read is put back from the guard\'s record, and the next check is clean', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('plan/plan.json', 'garbage {');
    const w = window([], { byShortcut: () => false });
    expect(await repair(w.io, home(app))).toBe(0);
    expect(app.read('plan/plan.json')).toBe(PLAN_TEXT);
    expect(w.said.join('\n')).toMatch(/put back plan\/plan\.json/i);
    expect(logText(app)).toMatch(/\d\d:\d\d Owner ran repair: put back plan\/plan\.json\n/);
    await clean(app);
  });

  test('so are an unreadable lock.json and state.json (from the copy of state the guard keeps), all at once', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const lock = app.read('.seam/lock.json');
    const state = app.read('.seam/state.json');
    app.writeRaw('.seam/lock.json', '');
    app.writeRaw('.seam/state.json', '{"version": 1');
    app.writeRaw('plan/plan.json', '[]');
    const w = window([], { byShortcut: () => false });
    expect(await repair(w.io, home(app))).toBe(0);
    expect(app.read('.seam/lock.json')).toBe(lock);
    expect(app.read('.seam/state.json')).toBe(state);
    expect(app.read('plan/plan.json')).toBe(PLAN_TEXT);
    await clean(app);
  });

  test('when everything reads fine it says so and changes nothing', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const before = [app.read('.seam/lock.json'), app.read('.seam/state.json'), app.read('plan/plan.json')];
    const w = window([], { byShortcut: () => false });
    expect(await repair(w.io, home(app))).toBe(0);
    expect(w.said.join('\n')).toMatch(/nothing needed repair/i);
    expect([app.read('.seam/lock.json'), app.read('.seam/state.json'), app.read('plan/plan.json')]).toEqual(before);
    expect(logText(app)).not.toMatch(/repair/);
  });

  test('with no saved copy to go back to it says which file is still unreadable, and fails', async () => {
    const app = await makeApp({ phase: 'build' });
    writeFileSync(app.abs('plan/plan.json'), 'garbage {');
    const w = window([], { byShortcut: () => false });
    expect(await repair(w.io, home(app))).toBe(1);
    expect(w.said.join('\n')).toMatch(/plan\/plan\.json is still unreadable.*no saved copy/s);
    expect(app.read('plan/plan.json')).toBe('garbage {');
  });

  test.each([
    ['stdin is not a terminal', { stdinTty: false }],
    ['stdout is not a terminal', { stdoutTty: false }],
  ])('refused when %s (it has to be the owner at a keyboard, not a command run for them)', async (_why, opts) => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('plan/plan.json', 'garbage {');
    const w = window([], opts);
    expect(await repair(w.io, home(app))).toBe(1);
    expect(w.said.join('\n')).toMatch(/your own terminal or the Seam Approve window/);
    expect(app.read('plan/plan.json')).toBe('garbage {');
  });

  test('through the command, with no keyboard, it is refused', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const r = await folderOf(app).cli(['repair']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/your own terminal or the Seam Approve window/);
  });
});

describe('the AI cannot run either of them (they are not on the list of seam commands it may run)', () => {
  test.each(['seam repair', 'seam edit src/pricing/total.ts', 'node dist/seam.mjs repair'])('%s is refused', async (command) => {
    const app = await makeApp({ phase: 'build', lock: true });
    expectDenied(await app.hook(run('Bash', command)), /isn't on seam's command list|not one of the seam commands/);
  });

  test('while the ones it needs are allowed', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    for (const command of ['seam report', 'seam status', 'seam request freeze']) expectAllowed(await app.hook(run('Bash', command)));
  });
});

describe('when a record file is damaged, the commands the AI can run say what the owner can do', () => {
  test.each(['report', 'request park'])('seam %s with an unreadable state.json names seam repair', async (command) => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('.seam/state.json', '{"version": 1');
    const r = await folderOf(app).cli(command.split(' '));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/state\.json/);
    expect(r.stderr).toMatch(/seam repair in your own terminal/);
  });
});
