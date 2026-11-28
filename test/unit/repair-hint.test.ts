// R80 (re-review of 832a99a): the hint "the owner can put it back with seam repair" went with any "is unreadable" error, including a
// malformed pending.json and env.json, which repair does not put back. It goes only with the files repair deals with: plan.json,
// lock.json and state.json (put back from the guard's record), and the guard's own record of the protected files (which cannot be
// put back from itself, so repair sets a damaged one aside, and the window's "accept my own edits" takes a fresh one).
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { repair } from '../../src/cli/repair.ts';
import { repairable } from '../../src/cli/hint.ts';
import { windowCommand } from '../../src/cli/window.ts';
import { rootKey } from '../../src/lib/store.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { folderOf, shownCode, window } from '../helpers/cli.ts';
import { ctxOf, logText } from '../helpers/tamper.ts';

const HINT = /seam repair in your own terminal/;
const recordFile = (app: App): string => join(app.dataDir, 'mirror', rootKey(app.root), 'protected.json');

describe('which errors the repair hint goes with', () => {
  test.each([
    ['plan/plan.json is unreadable: it is not valid JSON (x).', true],
    ['plan/plan.json is invalid:\n  - version: Invalid input', true],
    ['.seam/lock.json is unreadable: x', true],
    ['.seam/state.json is unreadable: x', true],
    ['.seam/state.json is missing, so this project\'s state cannot be read.', true],
    ["The guard's record of the protected files (C:/data/mirror/x/protected.json) is unreadable: x", true],
    ["The guard's record of the protected files (C:/data/mirror/x/protected.json) is not valid JSON (x).", true],
    ["The guard's record of the protected files is invalid:\n  - files: x", true],
    ['.seam/env.json is unreadable: it is not valid JSON (x).', false],
    ['.seam/env.json is invalid:\n  - dataDir: x', false],
    ['.seam/pending.json is unreadable: it is not valid JSON (x).', false],
    ['.seam/pending.json is invalid:\n  - kind: x', false],
    ['.seam/heartbeat.json is unreadable: x', false],
    ['src/pricing/total.ts is unreadable: x', false],
    ["This project's setup is incomplete; run seam init again from Claude Code.", false],
    ['something else went wrong', false],
  ])('%j', (message, expected) => {
    expect(repairable(message)).toBe(expected);
  });
});

describe('through the command', () => {
  test.each([
    ['plan.json', 'plan/plan.json', true], ['lock.json', '.seam/lock.json', true], ['state.json', '.seam/state.json', true],
  ])('a damaged %s gets the hint', async (_name, rel, hinted) => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(rel, '{ garbage');
    const r = await folderOf(app).cli(['report']);
    expect(r.exitCode).toBe(1);
    expect(HINT.test(r.stderr)).toBe(hinted);
  });

  test('a damaged guard record gets the hint', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    writeFileSync(recordFile(app), '{ garbage');
    const r = await folderOf(app).cli(['request', 'park']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/The guard's record of the protected files/);
    expect(r.stderr).toMatch(HINT);
  });

  test('a damaged env.json does not: repair would not put it back from the command line (the guard does, after the next tool call)', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('.seam/env.json', '{ garbage');
    const r = await folderOf(app).cli(['report']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/\.seam\/env\.json is unreadable/);
    expect(r.stderr).not.toMatch(/repair/i);
  });
});

describe('seam repair with a damaged guard record', () => {
  test('sets it aside (it cannot be put back from itself), says how to take a fresh one, and logs it', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    writeFileSync(recordFile(app), '{ garbage');
    const w = window([], { byShortcut: () => false });
    expect(await repair(w.io, { root: app.root, dataDir: app.dataDir })).toBe(0);
    const said = w.said.join('\n');
    expect(said).toMatch(/record of the protected files was damaged, and has been set aside/);
    expect(said).toMatch(/Accept my own edits/);
    expect(existsSync(recordFile(app))).toBe(false);
    expect(readdirSync(join(app.dataDir, 'quarantine'), { recursive: true }).some((p) => String(p).endsWith('protected.json'))).toBe(true);
    expect(logText(app)).toMatch(/Owner ran repair: set the damaged record of the protected files aside/);
  });

  test('and then the window\'s "accept my own edits" takes a fresh record, so the checks run again', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    writeFileSync(recordFile(app), '{ garbage');
    await repair(window([], { byShortcut: () => false }).io, { root: app.root, dataDir: app.dataDir });
    const w = window(['2', shownCode, '4']);
    expect(await windowCommand(w.io, () => ctxOf(app), () => ({ root: app.root, dataDir: app.dataDir }))).toBe(0);
    expect(existsSync(recordFile(app))).toBe(true);
    expectAllowed(await app.hook(post('Bash', { command: 'git status' })));
  });

  test('with a good record it is unchanged: nothing needed repair', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const w = window([], { byShortcut: () => false });
    expect(await repair(w.io, { root: app.root, dataDir: app.dataDir })).toBe(0);
    expect(w.said.join('\n')).toMatch(/Nothing needed repair/);
    expect(existsSync(recordFile(app))).toBe(true);
  });
});

describe('what the window says for an error repair cannot help with', () => {
  test('a damaged env.json is said as it is, with no "choose 3", and the window closes (nothing in it can mend that)', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('.seam/env.json', '{ garbage');
    const w = window(['4']);
    const code = await windowCommand(w.io, () => ctxOf(app), () => ({ root: app.root, dataDir: app.dataDir }));
    expect(code).toBe(1);
    expect(w.said.join('\n')).toMatch(/env\.json is unreadable/);
    expect(w.said.join('\n')).not.toMatch(/Choose 3|1\) Show the report/);
  });

  test('a damaged plan.json still says "Choose 3"', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('plan/plan.json', '{ garbage');
    const w = window(['4']);
    await windowCommand(w.io, () => ctxOf(app), () => ({ root: app.root, dataDir: app.dataDir }));
    expect(w.said.join('\n')).toMatch(/Choose 3/);
  });
});
