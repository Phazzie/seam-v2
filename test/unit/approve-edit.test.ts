// The `edit` approval (R77): it says it accepts the owner's own changes, so it does. Approving takes every protected file that differs
// from the guard's record into the record (and, where the lock has an entry for it, into the lock), clears the halt, and logs it; before,
// it only cleared the halt, and the next call put the owner's edit back and halted again.
import { rmSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { approve, approveCore } from '../../src/cli/approve.ts';
import { loadPending } from '../../src/cli/pending.ts';
import { loadLock } from '../../src/formats/lock.ts';
import { fingerprintCode, hash } from '../../src/lib/fingerprint.ts';
import { updateState } from '../../src/lib/store.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';
import { window } from '../helpers/cli.ts';
import { requested, stateOf } from '../helpers/approving.ts';
import { ctxOf, logText } from '../helpers/tamper.ts';

const A = 'tests/a.test.ts';
const B = 'tests/b.test.ts';
const NEW_TOTAL = total({ params: 'a: number, b: number, c = 0' });

async function stopped(): Promise<App> {
  const app = await makeApp({ phase: 'build', lock: true, files: { [A]: 'export const a = 1;\n', [B]: 'export const b = 1;\n' } });
  updateState(app.root, app.dataDir, (s) => ({ ...s, halted: 'the main AI changed a protected file: plan/plan.json' }));
  return app;
}
const clean = async (app: App): Promise<void> => {
  const r = await app.hook(post('Bash', { command: 'git status' }));
  expectAllowed(r);
  expect(r.stdout, 'the tamper check had something to say').toBe('');
};

describe('approving an edit', () => {
  test('takes the owner\'s changes (changed, deleted, new, a locked code file) into the record and the lock, and the next check is clean', async () => {
    const app = await stopped();
    const code = requested(app, 'edit');
    app.writeRaw(A, 'export const a = 2;\n');
    rmSync(app.abs(B));
    app.writeRaw('tests/c.test.ts', 'export const c = 1;\n');
    app.writeRaw(TOTAL, NEW_TOTAL);
    expect(approveCore({ typed: code }, ctxOf(app))).toEqual({ ok: true, kind: 'edit', phase: 'build' });
    expect(stateOf(app)).toMatchObject({ halted: null, approvals: [{ kind: 'edit' }] });
    const lock = loadLock(app.root)!.files;
    expect(lock[A]).toEqual({ kind: 'whole', hash: hash('export const a = 2;\n') });
    expect(lock[B]).toBeUndefined();
    expect(lock['tests/c.test.ts']).toBeUndefined(); // not in the lock before, and not added: a new file is only taken into the record
    expect(lock[TOTAL]).toEqual(fingerprintCode(TOTAL, NEW_TOTAL));
    expect(logText(app)).toMatch(/Owner accepted their own edits to: .*tests\/a\.test\.ts/);
    await clean(app);
    expect(app.read(A)).toBe('export const a = 2;\n');
    expect(app.read(TOTAL)).toBe(NEW_TOTAL);
  });

  test('with no change it only lets the run carry on, and says so in the window', async () => {
    const app = await stopped();
    const code = requested(app, 'edit');
    const w = window([code]);
    expect(await approve(w.io, () => ctxOf(app))).toBe(0);
    expect(w.said.join('\n')).toMatch(/No protected file differs from what the guard has, so approving only lets the run carry on/);
    expect(stateOf(app).halted).toBeNull();
    expect(logText(app)).not.toMatch(/accepted their own edits/);
  });

  test('the window lists what differs before the code is typed, and approving takes exactly that', async () => {
    const app = await stopped();
    const code = requested(app, 'edit');
    app.writeRaw(A, 'export const a = 2;\n');
    const w = window([code]);
    expect(await approve(w.io, () => ctxOf(app))).toBe(0);
    const screen = w.said.join('\n');
    expect(screen).toContain(`- ${A} (changed)`);
    expect(screen.indexOf(`- ${A}`)).toBeLessThan(screen.indexOf('Code: '));
  });

  test('a request for an edit never goes stale because the owner changed a file after it was asked for', async () => {
    const app = await stopped();
    const code = requested(app, 'edit');
    expect(loadPending(app.root)?.fingerprints).toEqual({});
    app.writeRaw(A, 'export const a = 2;\n');
    expect(approveCore({ typed: code }, ctxOf(app)).ok).toBe(true);
  });

  test('if the files change again after the owner was shown them, nothing is accepted', async () => {
    const app = await stopped();
    const code = requested(app, 'edit');
    app.writeRaw(A, 'export const a = 2;\n');
    const ctx = ctxOf(app);
    const w = window([(screen) => { app.writeRaw(A, 'export const a = 3;\n'); return /Code: ([A-Z0-9]{4})/.exec(screen)?.[1] ?? code; }]);
    expect(await approve(w.io, () => ctx)).toBe(1);
    expect(w.said.join('\n')).toMatch(/the files changed while you were deciding/);
    expect(stateOf(app).halted).not.toBeNull();
    expect(loadLock(app.root)!.files[A]).toEqual({ kind: 'whole', hash: hash('export const a = 1;\n') });
  });

  test('a locked code file that no longer parses stops the approval before anything is written', async () => {
    const app = await stopped();
    const code = requested(app, 'edit');
    app.writeRaw(TOTAL, 'export function total( {{{ \n');
    expect(() => approveCore({ typed: code }, ctxOf(app))).toThrow(/can't be accepted/);
    expect(stateOf(app).halted).not.toBeNull();
    expect(stateOf(app).approvals).toEqual([]);
    expect(loadLock(app.root)!.files[TOTAL]).toMatchObject({ kind: 'code' });
  });

  test('the guard\'s own records under .seam/ are not the owner\'s to edit by hand: they are left out', async () => {
    const app = await stopped();
    const code = requested(app, 'edit');
    app.writeRaw('.seam/env.json', '{"dataDir":"somewhere-else"}'); // valid, so it is a plain change (the guard now reads env.json)
    expect(approveCore({ typed: code }, ctxOf(app))).toMatchObject({ ok: true });
    expect(logText(app)).not.toMatch(/accepted their own edits/);
  });
});
