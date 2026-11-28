// R80 (Codex on PR #25): with the guard's record of the protected files missing, `seam edit <file>` silently took a fresh record of EVERY
// protected file, though its question was about one. Now it says so plainly, and the owner has to type a code to agree; otherwise
// nothing is accepted, and it points at the window's menu, which shows what a fresh record covers.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { editFile } from '../../src/cli/edit.ts';
import { loadLock } from '../../src/formats/lock.ts';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { rootKey } from '../../src/lib/store.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';
import { shownCode, window } from '../helpers/cli.ts';
import { ctxOf, logText } from '../helpers/tamper.ts';

const SAYS = 'The guard has no record of the protected files; agreeing takes a fresh record of every protected file as it is now';
const NEW_TOTAL = total({ params: 'a: number, b: number, c = 0' });
const record = (app: App): string => join(app.dataDir, 'mirror', rootKey(app.root), 'protected.json');

/** A locked project whose record is gone (nothing took one), with the owner's hand edit to a locked code file. */
async function noRecord(): Promise<App> {
  const app = await makeApp({ phase: 'build', lock: true, snapshot: false });
  app.writeRaw(TOTAL, NEW_TOTAL);
  expect(existsSync(record(app))).toBe(false);
  return app;
}

describe('seam edit when the guard has no record of the protected files', () => {
  test('it says what agreeing does, and a typed code agrees: the file\'s lock entry is refreshed and a fresh record is taken', async () => {
    const app = await noRecord();
    const w = window([shownCode]);
    expect(await editFile(w.io, () => ctxOf(app), TOTAL, app.root)).toBe(0);
    const said = w.said.join('\n');
    expect(said).toContain(SAYS);
    expect(said).toContain(TOTAL);
    expect(w.asked.some((q) => /Type the code above/.test(q))).toBe(true);
    expect(w.asked.some((q) => /Type yes/.test(q))).toBe(false); // the code, not a yes
    expect(existsSync(record(app))).toBe(true);
    expect(loadLock(app.root)!.files[TOTAL]).toEqual(fingerprintCode(TOTAL, NEW_TOTAL));
    expect(logText(app)).toMatch(/Owner accepted a hand edit to src\/pricing\/total\.ts/);
    expectAllowed(await app.hook(post('Bash', { command: 'git status' })));
    expect(app.read(TOTAL)).toBe(NEW_TOTAL);
  });

  test('a yes is not enough: three answers that are not the code accept nothing, and the window\'s menu is suggested', async () => {
    const app = await noRecord();
    const w = window(['yes', 'y', 'yes']);
    expect(await editFile(w.io, () => ctxOf(app), TOTAL, app.root)).toBe(1);
    const said = w.said.join('\n');
    expect(said).toContain(SAYS);
    expect(said).toMatch(/Three wrong tries, so nothing was accepted/);
    expect(said).toMatch(/menu \(choice 2\)/);
    expect(existsSync(record(app))).toBe(false);
    expect(loadLock(app.root)!.files[TOTAL]).not.toEqual(fingerprintCode(TOTAL, NEW_TOTAL));
    expect(logText(app)).not.toMatch(/hand edit/);
  });

  test('with a record it is as before: it asks about the one file, with a yes, and says nothing about a fresh record', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(TOTAL, NEW_TOTAL);
    const w = window(['yes']);
    expect(await editFile(w.io, () => ctxOf(app), TOTAL, app.root)).toBe(0);
    expect(w.said.join('\n')).not.toContain('no record');
    expect(w.asked.some((q) => /Type yes/.test(q))).toBe(true);
  });
});
