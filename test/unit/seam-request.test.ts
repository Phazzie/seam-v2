// `seam request <kind>` (Task 13): the main AI asks the owner to approve something; the request is written, never approved.
import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CODE_ALPHABET, loadPending } from '../../src/cli/pending.ts';
import { makeApp } from '../helpers/app.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';
import { folderOf } from '../helpers/cli.ts';
import { GREETING, PENDING, appIn, codeOf, stateOf } from '../helpers/approving.ts';

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
