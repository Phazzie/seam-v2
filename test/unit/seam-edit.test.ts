// `seam edit <file>` (Task 13): the owner's own change to a protected file taken into the guard's record (and into the lock),
// where the tamper check would otherwise put it back as the AI's tampering.
import { rmSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { editFile } from '../../src/cli/edit.ts';
import { loadLock } from '../../src/formats/lock.ts';
import { loadPlan } from '../../src/formats/plan.ts';
import { loadState } from '../../src/formats/state.ts';
import { fingerprintCode, hash } from '../../src/lib/fingerprint.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, expectBlocked, post } from '../helpers/calls.ts';
import { PLAN_TEXT, TOTAL, total } from '../helpers/code.ts';
import { folderOf, window } from '../helpers/cli.ts';
import { ctxOf, logText } from '../helpers/tamper.ts';

const THE_WINDOW = 'edits are accepted in your own terminal or the Seam Approve window, not through Claude';
const bash = post('Bash', { command: 'git status' });
const NEW_TOTAL = total({ params: 'a: number, b: number, c = 0' });
const home = (app: App) => ({ root: app.root, dataDir: app.dataDir });
const edited = (app: App, rel: string, answer = 'y') => {
  const w = window([answer]);
  return editFile(w.io, () => ctxOf(app), rel, app.root).then((code) => ({ code, w }));
};
const clean = async (app: App): Promise<void> => {
  const r = await app.hook(bash);
  expectAllowed(r);
  expect(r.stdout, 'the tamper check had something to say').toBe('');
  expect(loadState(app.root)?.halted).toBeNull();
};


describe('seam edit', () => {
  test('without edit, a hand edit to a protected file is put back (which is why edit exists)', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(TOTAL, NEW_TOTAL);
    expectBlocked(await app.hook(bash), /was changed outside the rules and has been put back/);
  });

  test('a locked code file the owner changed by hand is accepted: the record and the lock now describe it', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(TOTAL, NEW_TOTAL);
    const { code, w } = await edited(app, TOTAL);
    expect(code, w.said.join('\n')).toBe(0);
    expect(app.read(TOTAL)).toBe(NEW_TOTAL);
    expect(loadLock(app.root)!.files[TOTAL]).toEqual(fingerprintCode(TOTAL, NEW_TOTAL));
    expect(logText(app)).toMatch(/\d\d:\d\d Owner accepted a hand edit to src\/pricing\/total\.ts\n/);
    await clean(app);
    expect(app.read(TOTAL)).toBe(NEW_TOTAL);
  });

  test('the file may be named from where the owner is, or by its full path', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(TOTAL, NEW_TOTAL);
    expect((await edited(app, app.abs(TOTAL))).code).toBe(0);
    await clean(app);
  });

  test('a file locked whole (the plan) has its lock entry updated too, and a plan that cannot be read is refused', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const changed = PLAN_TEXT.replace('"estLines": 25', '"estLines": 26');
    app.writeRaw('plan/plan.json', changed);
    expect((await edited(app, 'plan/plan.json')).code).toBe(0);
    expect(loadLock(app.root)!.files['plan/plan.json']).toEqual({ kind: 'whole', hash: hash(changed) });
    expect(loadPlan(app.root)?.seams[0].files[0].estLines).toBe(26);
    await clean(app);

    const broken = await makeApp({ phase: 'build', lock: true });
    broken.writeRaw('plan/plan.json', '{ nope');
    const { code, w } = await edited(broken, 'plan/plan.json');
    expect(code).toBe(1);
    expect(w.said.join('\n')).toMatch(/plan\/plan\.json is unreadable.*Nothing was accepted/s);
    expect(loadLock(broken.root)!.files['plan/plan.json']).toMatchObject({ kind: 'whole', hash: hash(PLAN_TEXT) });
  });

  test('a test file the owner changed, and one the owner deleted', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { 'tests/a.test.ts': 'export const a = 1;\n', 'tests/b.test.ts': 'export const b = 1;\n' } });
    app.writeRaw('tests/a.test.ts', 'export const a = 2;\n');
    rmSync(app.abs('tests/b.test.ts'));
    expect((await edited(app, 'tests/a.test.ts')).code).toBe(0);
    expect((await edited(app, 'tests/b.test.ts')).code).toBe(0);
    expect(loadLock(app.root)!.files['tests/a.test.ts']).toEqual({ kind: 'whole', hash: hash('export const a = 2;\n') });
    expect(Object.keys(loadLock(app.root)!.files)).not.toContain('tests/b.test.ts');
    await clean(app);
    expect(app.read('tests/a.test.ts')).toBe('export const a = 2;\n');
  });

  test('it shows what it is about to accept and asks; anything but yes accepts nothing', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(TOTAL, NEW_TOTAL);
    const { code, w } = await edited(app, TOTAL, 'no');
    expect(code).toBe(1);
    expect(w.said.join('\n')).toContain(TOTAL);
    expect(w.asked).toHaveLength(1);
    expect(loadLock(app.root)!.files[TOTAL]).not.toEqual(fingerprintCode(TOTAL, NEW_TOTAL));
    expect(logText(app)).not.toMatch(/hand edit/);
    expectBlocked(await app.hook(bash), /put back/);
  });

  test.each([
    ['stdin is not a terminal', { stdinTty: false }],
    ['stdout is not a terminal', { stdoutTty: false }],
  ])('refused when %s (it has to be the owner at a keyboard), and nothing is asked', async (_why, opts) => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(TOTAL, NEW_TOTAL);
    const w = window(['y'], opts);
    expect(await editFile(w.io, () => ctxOf(app), TOTAL, app.root)).toBe(1);
    expect(w.said.join('\n')).toContain(THE_WINDOW);
    expect(w.asked).toEqual([]);
    expect(loadLock(app.root)!.files[TOTAL]).not.toEqual(fingerprintCode(TOTAL, NEW_TOTAL));
  });

  test('R77: the owner\'s own terminal is enough: it works without the shortcut, and the shortcut is not even looked for', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(TOTAL, NEW_TOTAL);
    let looked = 0;
    const w = window(['yes'], { byShortcut: () => { looked += 1; return false; } });
    expect(await editFile(w.io, () => ctxOf(app), TOTAL, app.root)).toBe(0);
    expect(looked).toBe(0);
    expect(loadLock(app.root)!.files[TOTAL]).toEqual(fingerprintCode(TOTAL, NEW_TOTAL));
  });

  test('through the command, with no keyboard, it is refused too', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(TOTAL, NEW_TOTAL);
    const r = await folderOf(app).cli(['edit', TOTAL]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain(THE_WINDOW);
  });

  test.each([
    [undefined, /which file/i],
    ['.seam/state.json', /\.seam.*seam repair|seam repair/i],
    ['.seam/lock.json', /\.seam/],
    ['../outside.txt', /not inside this project/i],
  ])('%s is not a file to accept: %s', async (file, why) => {
    const app = await makeApp({ phase: 'build', lock: true });
    const w = window(['y']);
    expect(await editFile(w.io, () => ctxOf(app), file, app.root)).toBe(1);
    expect(w.said.join('\n')).toMatch(why);
    expect(w.asked).toEqual([]);
  });

  test('a file the guard does not watch needs nothing, and a file that is not there is said so', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { 'README.md': 'hello\n' } });
    const plain = window(['y']);
    expect(await editFile(plain.io, () => ctxOf(app), 'README.md', app.root)).toBe(0);
    expect(plain.said.join('\n')).toMatch(/does not watch/);
    const missing = window(['y']);
    expect(await editFile(missing.io, () => ctxOf(app), 'tests/never.test.ts', app.root)).toBe(1);
    expect(missing.said.join('\n')).toMatch(/not there/);
  });
});
