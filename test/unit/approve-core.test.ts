// `approveCore` (Task 13): what decides an approval: the code, whether the request is still what was asked for, and then the
// phase move and its records.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { approveCore } from '../../src/cli/approve.ts';
import { loadPending } from '../../src/cli/pending.ts';
import { requestApproval } from '../../src/cli/request.ts';
import { loadLock } from '../../src/formats/lock.ts';
import { rootKey, updateState } from '../../src/lib/store.ts';
import { makeApp } from '../helpers/app.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';
import { GREETING, PENDING, STALE, appIn, plantedRequest, requested, skeletons, stateOf } from '../helpers/approving.ts';
import { ctxOf, logText } from '../helpers/tamper.ts';

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

describe('what a script the AI can run must not do', () => {
  test('seam request with no record of the protected files yet does not start one (a snapshot would bless whatever the guard is blocking on)', async () => {
    const app = await makeApp({ phase: 'tests', files: skeletons() }); // no snapshot taken
    requestApproval(ctxOf(app), 'park');
    expect(existsSync(join(app.dataDir, 'mirror', rootKey(app.root), 'protected.json'))).toBe(false);
    expect(existsSync(app.abs(PENDING))).toBe(true);
  });
});
