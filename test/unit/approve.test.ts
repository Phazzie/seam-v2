// `seam request` and `seam approve` (Task 13): the owner approves the big steps in the Seam Approve window, never in the chat.
// `approveCore` is the part that decides (the code, what changed, the phase move); `approve` wraps it in the window's
// checks (a real keyboard, opened from the shortcut) and the three tries.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { approve, approveCore } from '../../src/cli/approve.ts';
import { CODE_ALPHABET, loadPending } from '../../src/cli/pending.ts';
import { requestApproval } from '../../src/cli/request.ts';
import { loadLock } from '../../src/formats/lock.ts';
import { loadState } from '../../src/formats/state.ts';
import { rootKey, updateState } from '../../src/lib/store.ts';
import type { Phase } from '../../src/types.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { PLAN_TEXT, TOTAL, planFile, skeleton } from '../helpers/code.ts';
import { folderOf, window } from '../helpers/cli.ts';
import { ctxOf, logText } from '../helpers/tamper.ts';

const PENDING = '.seam/pending.json';
const GREETING = 'src/greeting/Greeting.tsx';
const THE_WINDOW = 'approvals happen in the Seam Approve window on your desktop';
const STALE = 'things changed since this was requested; ask for a fresh approval';

const skeletons = (): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const path of [TOTAL, GREETING]) {
    const { seam, file } = planFile(path);
    files[path] = skeleton(seam, file);
  }
  return files;
};

/** An app in `phase` with a record of its protected files, and (so the plan can be frozen) a skeleton for every planned file. */
const appIn = (phase: Phase): Promise<App> => makeApp({ phase, snapshot: true, files: skeletons() });
const stateOf = (app: App) => loadState(app.root)!;
const codeOf = (app: App): string => loadPending(app.root)!.code;

/** Ask for an approval the way the main AI does (`seam request <kind>`), and give back the code the owner would see in the window. */
function requested(app: App, kind: string): string {
  requestApproval(ctxOf(app), kind);
  return codeOf(app);
}

/** A request for a kind that does not fit the phase, which `seam request` itself refuses: written by hand, to test what approving does with it. */
function plantedRequest(app: App, kind: string): string {
  const code = requested(app, 'park');
  app.writeRaw(PENDING, JSON.stringify({ ...loadPending(app.root)!, kind }));
  return code;
}

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

describe('approveCore', () => {
  test('a wrong code records nothing and moves nothing; the right one then still works', async () => {
    const app = await appIn('tests');
    const code = requested(app, 'freeze');
    const before = stateOf(app);
    expect(approveCore({ typed: 'XXXX' }, ctxOf(app))).toEqual({ ok: false, retry: true, reason: 'that is not the code' });
    expect(stateOf(app)).toEqual(before);
    expect(existsSync(app.abs('.seam/lock.json'))).toBe(false);
    expect(existsSync(app.abs(PENDING))).toBe(true);
    expect(logText(app)).not.toMatch(/approved/);
    expect(approveCore({ typed: code }, ctxOf(app))).toMatchObject({ ok: true });
  });

  test('freeze: tests -> build, the lock is written, the approval keeps what was shown, and the request is used up', async () => {
    const app = await appIn('tests');
    const code = requested(app, 'freeze');
    const pending = loadPending(app.root)!;
    expect(approveCore({ typed: code }, ctxOf(app))).toEqual({ ok: true, kind: 'freeze', phase: 'build' });
    const state = stateOf(app);
    expect(state.phase).toBe('build');
    expect(state.approvals).toHaveLength(1);
    expect(state.approvals[0]).toMatchObject({ kind: 'freeze', fingerprints: pending.fingerprints, summary: pending.summary });
    expect(Number.isFinite(Date.parse(state.approvals[0].at))).toBe(true);
    expect(Object.keys(loadLock(app.root)!.files).sort()).toEqual(['plan/plan.json', TOTAL, GREETING].sort());
    expect(existsSync(app.abs(PENDING))).toBe(false);
    expect(logText(app)).toMatch(/\d\d:\d\d Owner approved freeze\n/);
    expect(app.read('.seam/state.json')).toBe(readFileSync(join(app.dataDir, 'mirror', rootKey(app.root), 'state.json'), 'utf8'));
  });

  test.each(['setup', 'survey'] as const)('features: %s -> plan1', async (phase) => {
    const app = await appIn(phase);
    const code = requested(app, 'features');
    expect(approveCore({ typed: code }, ctxOf(app))).toEqual({ ok: true, kind: 'features', phase: 'plan1' });
    expect(stateOf(app)).toMatchObject({ phase: 'plan1', approvals: [{ kind: 'features' }] });
    expect(existsSync(app.abs('.seam/lock.json'))).toBe(false);
  });

  test.each([
    ['features', 'plan2'], ['features', 'build'], ['freeze', 'plan1'], ['freeze', 'build'], ['freeze', 'skeleton'],
  ] as const)('%s does not fit the %s phase: nothing is recorded', async (kind, phase) => {
    const app = await appIn(phase);
    const code = plantedRequest(app, kind);
    expect(approveCore({ typed: code }, ctxOf(app))).toMatchObject({ ok: false, retry: false });
    expect(stateOf(app)).toMatchObject({ phase, approvals: [] });
    expect(existsSync(app.abs('.seam/lock.json'))).toBe(false);
  });

  test.each(['park', 'edit'] as const)('%s clears the halt and keeps the phase', async (kind) => {
    const app = await appIn('build');
    updateState(app.root, app.dataDir, (s) => ({ ...s, halted: 'the main AI changed a protected file: plan/plan.json' }));
    const code = requested(app, kind);
    expect(approveCore({ typed: code }, ctxOf(app))).toEqual({ ok: true, kind, phase: 'build' });
    expect(stateOf(app)).toMatchObject({ phase: 'build', halted: null, approvals: [{ kind }] });
  });

  test.each(['flips', 'cutover', 'reopen'] as const)('%s is recorded, and neither moves the phase nor clears a halt (that comes in a later stage)', async (kind) => {
    const app = await appIn('build');
    updateState(app.root, app.dataDir, (s) => ({ ...s, halted: 'because' }));
    const code = requested(app, kind);
    expect(approveCore({ typed: code }, ctxOf(app))).toMatchObject({ ok: true, kind, phase: 'build' });
    expect(stateOf(app)).toMatchObject({ phase: 'build', halted: 'because', approvals: [{ kind }] });
  });

  test('a request is used once: approving again finds nothing waiting', async () => {
    const app = await appIn('tests');
    const code = requested(app, 'freeze');
    expect(approveCore({ typed: code }, ctxOf(app)).ok).toBe(true);
    expect(approveCore({ typed: code }, ctxOf(app))).toEqual({ ok: false, retry: false, reason: 'there is nothing waiting for your approval' });
  });

  test.each([['setup', 'features'], ['tests', 'freeze'], ['build', 'park']] as const)(
    'in %s, after asking for and approving %s the tamper check finds nothing wrong (I-3: a script that changes a protected file accepts it)',
    async (phase, kind) => {
      const app = await appIn(phase);
      const code = requested(app, kind);
      expectAllowed(await app.hook(post('Bash', { command: 'git status' })));
      expect(existsSync(app.abs(PENDING)), 'the request was put back or moved aside').toBe(true);
      approveCore({ typed: code }, ctxOf(app));
      const r = await app.hook(post('Bash', { command: 'git status' }));
      expectAllowed(r);
      expect(r.stdout).toBe('');
      expect(stateOf(app).halted).toBeNull();
      expect(logText(app)).not.toMatch(/put back|moved|halted/i);
      expect(existsSync(app.abs(PENDING))).toBe(false);
    },
  );
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

describe('seam request', () => {
  test('writes .seam/pending.json: the kind, a 4-character code, what the owner will be shown, and the fingerprints', async () => {
    const app = await appIn('tests');
    const r = await folderOf(app).cli(['request', 'freeze']);
    expect(r.exitCode, r.stderr).toBe(0);
    const pending = JSON.parse(app.read(PENDING)) as { kind: string; code: string; summary: string; fingerprints: Record<string, string> };
    expect(Object.keys(pending).sort()).toEqual(['code', 'fingerprints', 'kind', 'summary']);
    expect(pending.kind).toBe('freeze');
    expect(pending.code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{4}$`));
    expect(Object.keys(pending.fingerprints).sort()).toEqual(['plan/plan.json', TOTAL, GREETING].sort());
    for (const hash of Object.values(pending.fingerprints)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(pending.summary).toMatch(/freeze/i);
    expect(pending.summary).toContain(TOTAL);
    expect(pending.summary).toMatch(/tests/); // the phase it is asked in
  });

  test('the alphabet leaves out the look-alikes (I, L, O, 0, 1)', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  });

  test('it does not print the code (the AI sees what a command prints; the owner reads the code in the window)', async () => {
    const app = await appIn('tests');
    const r = await folderOf(app).cli(['request', 'freeze']);
    expect(r.stdout + r.stderr).not.toContain(codeOf(app));
    expect(r.stdout).toMatch(/Seam Approve/);
  });

  test('the main AI may run it (the guard lets it through), and the tamper check leaves the request alone', async () => {
    const app = await appIn('tests');
    const r = await folderOf(app).cli(['request', 'freeze']);
    expect(r.exitCode).toBe(0);
    expectAllowed(await app.hook(post('Bash', { command: 'seam request freeze' })));
    expect(existsSync(app.abs(PENDING))).toBe(true);
    expect(stateOf(app).halted).toBeNull();
  });

  test('a new request replaces the one waiting', async () => {
    const app = await appIn('build');
    await folderOf(app).cli(['request', 'park']);
    await folderOf(app).cli(['request', 'edit']);
    expect(loadPending(app.root)?.kind).toBe('edit');
  });

  test('an unknown kind is refused and the kinds are listed', async () => {
    const app = await appIn('tests');
    const r = await folderOf(app).cli(['request', 'pizza']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/features, freeze, flips, cutover, reopen, park, edit/);
    expect(existsSync(app.abs(PENDING))).toBe(false);
  });

  test('freeze can only be asked for in the tests phase, features in setup or survey', async () => {
    const early = await appIn('plan1');
    const r = await folderOf(early).cli(['request', 'freeze']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/tests phase/);
    const late = await appIn('build');
    expect((await folderOf(late).cli(['request', 'features'])).exitCode).toBe(1);
    expect(existsSync(early.abs(PENDING))).toBe(false);
    expect(existsSync(late.abs(PENDING))).toBe(false);
  });

  test('freeze with a planned file missing names the file and writes nothing', async () => {
    const app = await makeApp({ phase: 'tests', snapshot: true });
    const r = await folderOf(app).cli(['request', 'freeze']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain(TOTAL);
    expect(existsSync(app.abs(PENDING))).toBe(false);
  });
});

describe('what a script the AI can run must not do', () => {
  test('seam request with no record of the protected files yet does not start one (a snapshot would bless whatever the guard is blocking on)', async () => {
    const app = await makeApp({ phase: 'tests', files: skeletons() }); // no snapshot taken
    requestApproval(ctxOf(app), 'park');
    expect(existsSync(join(app.dataDir, 'mirror', rootKey(app.root), 'protected.json'))).toBe(false);
    expect(existsSync(app.abs(PENDING))).toBe(true);
  });
});
