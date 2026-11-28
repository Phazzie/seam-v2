// `seam approve` (Task 13): the owner approves the big steps in the Seam Approve window, never in the chat. `approve` is the
// window's side: a real keyboard, opened from the shortcut, a request that is still what was asked for, and three tries at the code.
import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { approve, approveCore } from '../../src/cli/approve.ts';
import { loadPending } from '../../src/cli/pending.ts';
import { PLAN_TEXT, TOTAL } from '../helpers/code.ts';
import { folderOf, window } from '../helpers/cli.ts';
import { GREETING, PENDING, STALE, THE_WINDOW, appIn, codeOf, plantedRequest, requested, skeletons, stateOf } from '../helpers/approving.ts';
import { ctxOf } from '../helpers/tamper.ts';

describe('seam approve refuses to run outside the approval window', () => {
  test('with stdin piped (no keyboard) it exits 1 with the window message and changes nothing', async () => {
    const app = await appIn('tests');
    requested(app, 'freeze');
    const r = await folderOf(app).cli(['approve']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain(THE_WINDOW);
    expect(stateOf(app)).toMatchObject({ phase: 'tests', approvals: [] });
    expect(existsSync(app.abs('.seam/lock.json'))).toBe(false);
    expect(existsSync(app.abs(PENDING))).toBe(true);
  });

  test.each([
    ['stdin is not a terminal', { stdinTty: false }],
    ['stdout is not a terminal', { stdoutTty: false }],
    ['it was not opened from the shortcut', { byShortcut: () => false }],
  ])('%s: refused with the window message, nothing asked, nothing changed', async (_why, opts) => {
    const app = await appIn('tests');
    const code = requested(app, 'freeze');
    const w = window([code], opts);
    expect(await approve(w.io, () => ctxOf(app))).toBe(1);
    expect(w.said.join('\n')).toContain(THE_WINDOW);
    expect(w.asked).toEqual([]);
    expect(stateOf(app).phase).toBe('tests');
  });

  test('the shortcut is not looked for when there is no keyboard (that check starts PowerShell), and the project is not loaded', async () => {
    let looked = 0;
    const w = window([], { stdinTty: false, byShortcut: () => { looked += 1; return false; } });
    expect(await approve(w.io, () => { throw new Error('the project must not be loaded before the window is checked'); })).toBe(1);
    expect(looked).toBe(0);
  });

  test('nothing waiting: it says so', async () => {
    const app = await appIn('tests');
    const w = window([]);
    expect(await approve(w.io, () => ctxOf(app))).toBe(1);
    expect(w.said.join('\n')).toMatch(/nothing waiting for your approval/);
  });

  test('a request gone stale is refused before the summary or the code is shown: a planned file changed after it was asked for', async () => {
    const app = await appIn('tests');
    const code = requested(app, 'freeze');
    app.writeRaw(TOTAL, `${app.read(TOTAL)}// changed by hand\n`);
    const w = window([code]);
    expect(await approve(w.io, () => ctxOf(app))).toBe(1);
    expect(w.said.join('\n')).toContain(STALE);
    expect(w.said.join('\n')).not.toContain(code);
    expect(w.asked).toEqual([]);
    expect(stateOf(app)).toMatchObject({ phase: 'tests', approvals: [] });
    expect(existsSync(app.abs('.seam/lock.json'))).toBe(false);
  });

  test.each([
    ['a new file in a frozen folder', 'tests/new.test.ts', 'export {};\n'],
    ['the plan edited', 'plan/plan.json', PLAN_TEXT.replace('"estLines": 25', '"estLines": 26')],
    ['a planned file edited', GREETING, `${skeletons()[GREETING]}// more\n`],
  ])('approveCore refuses a stale request too: %s', async (_what, rel, text) => {
    const app = await appIn('tests');
    const code = requested(app, 'freeze');
    app.writeRaw(rel, text);
    expect(approveCore({ typed: code }, ctxOf(app))).toEqual({ ok: false, retry: false, reason: STALE });
    expect(stateOf(app)).toMatchObject({ phase: 'tests', approvals: [] });
  });
});

describe('seam approve in the window', () => {
  test('it shows what is being approved and the code, asks for the code, and approves on the right one', async () => {
    const app = await appIn('tests');
    const code = requested(app, 'freeze');
    const summary = loadPending(app.root)!.summary;
    const w = window([code]);
    expect(await approve(w.io, () => ctxOf(app))).toBe(0);
    const screen = w.said.join('\n');
    expect(screen).toContain(summary);
    expect(screen).toContain(code);
    expect(w.asked).toHaveLength(1);
    expect(stateOf(app).phase).toBe('build');
    expect(screen).toMatch(/approved freeze/i);
  });

  test('the code is the same in lower case, and a space around it does not matter', async () => {
    const app = await appIn('tests');
    const code = requested(app, 'freeze');
    expect(await approve(window([` ${code.toLowerCase()} `]).io, () => ctxOf(app))).toBe(0);
    expect(stateOf(app).phase).toBe('build');
  });

  test('a wrong try can be corrected, up to three', async () => {
    const app = await appIn('tests');
    const code = requested(app, 'freeze');
    const w = window(['nope', 'XXXX', code]);
    expect(await approve(w.io, () => ctxOf(app))).toBe(0);
    expect(w.asked).toHaveLength(3);
    expect(stateOf(app).phase).toBe('build');
  });

  test('three wrong tries end it: nothing is recorded, and the request stays for another go', async () => {
    const app = await appIn('tests');
    const code = requested(app, 'freeze');
    const w = window(['AAAA', 'BBBB', 'CCCC', code]);
    expect(await approve(w.io, () => ctxOf(app))).toBe(1);
    expect(w.asked).toHaveLength(3);
    expect(w.said.join('\n')).toMatch(/three/i);
    expect(stateOf(app)).toMatchObject({ phase: 'tests', approvals: [] });
    expect(existsSync(app.abs(PENDING))).toBe(true);
  });

  test('a request that does not fit the phase is refused with the reason, and no tries are used', async () => {
    const app = await appIn('plan1');
    const code = plantedRequest(app, 'freeze');
    const w = window([code]);
    expect(await approve(w.io, () => ctxOf(app))).toBe(1);
    expect(w.said.join('\n')).toMatch(/tests phase/);
    expect(stateOf(app)).toMatchObject({ phase: 'plan1', approvals: [] });
  });
});
