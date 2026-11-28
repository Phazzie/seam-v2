// R83 (Codex on PR #25): approving a freeze took a whole new snapshot of the protected files, so a protected file the freeze does not
// cover (the old app, the Claude config) that changed while the approval was waiting was accepted into the guard's record as the new
// normal, and the tamper check could no longer put the old one back. Approving now updates the record only for the files the freeze
// covers (the ones that were fingerprinted for the owner, the new lock, the used-up request) and leaves every other entry as it was.
import { createHash } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { approveCore } from '../../src/cli/approve.ts';
import { snapshotProtected } from '../../src/guard/tamper.ts';
import { recordFolder } from '../../src/guard/tamperrecord.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';
import { appIn, GREETING, requested, stateOf } from '../helpers/approving.ts';
import { ctxOf, recordOf } from '../helpers/tamper.ts';
import type { App } from '../helpers/app.ts';

const bash = post('Bash', { command: 'git status' });
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** An app in the tests phase whose record holds an old app (old/page.html) and a Claude setting, with a freeze asked for. */
async function waitingFreeze(): Promise<{ app: App; code: string }> {
  const app = await appIn('tests');
  app.writeRaw('old/page.html', '<p>old</p>');
  app.writeRaw('.claude/settings.json', '{"a":1}\n');
  app.writeRaw('.seam/env.json', JSON.stringify({ dataDir: app.dataDir, legacyRoot: 'old' }));
  snapshotProtected(ctxOf(app));
  return { app, code: requested(app, 'freeze') };
}

describe('a protected file the freeze does not cover that changes while the approval is waiting', () => {
  test.each([
    ['the old app', 'old/page.html', '<p>old</p>', '<p>changed</p>'],
    ['the Claude settings', '.claude/settings.json', '{"a":1}\n', '{"a":2}\n'],
  ])('%s: the guard\'s record keeps the original, and the next check puts it back', async (_what, file, original, changed) => {
    const { app, code } = await waitingFreeze();
    expect(recordOf(app).files[file].hash).toBe(sha(original));
    app.writeRaw(file, changed);
    expect(approveCore({ typed: code }, ctxOf(app))).toEqual({ ok: true, kind: 'freeze', phase: 'build' });
    expect(recordOf(app).files[file].hash).toBe(sha(original));
    await app.hook(bash);
    expect(app.read(file)).toBe(original);
  });

  test('a new code file nobody planned is not added to the record of code files either', async () => {
    const { app, code } = await waitingFreeze();
    app.writeRaw('src/extra.ts', 'export const extra = 1;\n');
    expect(approveCore({ typed: code }, ctxOf(app))).toMatchObject({ ok: true });
    expect(recordOf(app).code).not.toContain('src/extra.ts');
  });
});

describe('what the freeze does cover is recorded, and the next check is clean', () => {
  test('the planned files, the plan, the new lock; the used-up request is gone from the record', async () => {
    const { app, code } = await waitingFreeze();
    expect(recordOf(app).files['.seam/pending.json']).toBeDefined();
    expect(approveCore({ typed: code }, ctxOf(app))).toMatchObject({ ok: true });
    const files = recordOf(app).files;
    for (const key of [TOTAL, GREETING, 'plan/plan.json', '.seam/lock.json']) expect(files[key], key).toBeDefined();
    expect(files['.seam/pending.json']).toBeUndefined();
    expect(recordOf(app).code).toEqual(expect.arrayContaining([TOTAL, GREETING]));
    const r = await app.hook(bash);
    expectAllowed(r);
    expect(r.stdout, 'the tamper check had something to say').toBe('');
    expect(stateOf(app).halted).toBeNull();
  });

  test('the planned code files are held from now on: a change to one is caught', async () => {
    const { app, code } = await waitingFreeze();
    const before = app.read(TOTAL);
    expect(approveCore({ typed: code }, ctxOf(app))).toMatchObject({ ok: true });
    app.writeRaw(TOTAL, `${before}// sneaked in\n`);
    await app.hook(bash);
    expect(app.read(TOTAL)).toBe(before);
  });
});

describe('a record that is not there, or is damaged', () => {
  test('with no record at all the approval goes through and does not start one (the owner\'s "accept my own edits" does, as for any lost record)', async () => {
    const { app, code } = await waitingFreeze();
    rmSync(recordFolder({ root: app.root, dataDir: app.dataDir }), { recursive: true, force: true });
    expect(approveCore({ typed: code }, ctxOf(app))).toMatchObject({ ok: true });
    expect(existsSync(`${recordFolder({ root: app.root, dataDir: app.dataDir })}/protected.json`)).toBe(false);
  });

  test('a damaged record stops the approval before anything is changed: no lock, the phase as it was, the request still waiting', async () => {
    const { app, code } = await waitingFreeze();
    const file = `${recordFolder({ root: app.root, dataDir: app.dataDir })}/protected.json`;
    writeFileSync(file, '{ garbage');
    expect(() => approveCore({ typed: code }, ctxOf(app))).toThrow(/record/i);
    expect(existsSync(app.abs('.seam/lock.json'))).toBe(false);
    expect(stateOf(app).phase).toBe('tests');
    expect(existsSync(app.abs('.seam/pending.json'))).toBe(true);
  });
});
