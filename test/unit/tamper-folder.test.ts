// R78 (Codex on PR #23): a command that replaces a recorded protected FILE with a FOLDER. The check hashed it to see whether it was
// the same, and reading a folder throws, so (when the folder's size is the file's, which is 0 for both on Windows when the file is
// empty) the whole check failed and every call after it was refused for good. A folder where a file was recorded is a change like any
// other: the folder is moved to quarantine (not deleted, not read), the file is put back from its kept copy, and the reason is plain.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, expectBlocked, post } from '../helpers/calls.ts';
import { tempDir } from '../helpers/project.ts';
import { logText, problemsOf, quarantined, stateOf } from '../helpers/tamper.ts';

const FILE = 'tests/same.txt';
/** What a folder measures here (0 on Windows, 4096 on most Linux file systems): a file of exactly that size is the one the old check hashed. */
const FOLDER_SIZE = statSync(tempDir()).size;
const CONTENT = 'a'.repeat(FOLDER_SIZE);
const bash = post('Bash', { command: 'x' });

/** A built app that records a protected file whose size is a folder's, then has the file swapped for a folder holding something. */
async function swapped(rel = FILE, content = CONTENT): Promise<App> {
  const app = await makeApp({ phase: 'build', lock: true, files: { [rel]: content } });
  rmSync(app.abs(rel));
  mkdirSync(app.abs(rel));
  writeFileSync(join(app.abs(rel), 'inner.txt'), 'the folder holds this');
  return app;
}
/** Everything under the quarantine folder, as paths below the folder of its own time. */
const quarantine = (app: App): string[] =>
  existsSync(join(app.dataDir, 'quarantine')) ? readdirSync(join(app.dataDir, 'quarantine'), { recursive: true }).map((p) => String(p).replace(/\\/g, '/')) : [];

describe('a recorded file replaced by a folder', () => {
  test('is put back, and says so, instead of the check failing', async () => {
    const app = await swapped();
    const problems = await problemsOf(app, bash);
    expect(problems).toContain(`${FILE} was replaced by a folder outside the rules and has been put back (the folder was moved aside, not deleted)`);
    expect(statSync(app.abs(FILE)).isFile()).toBe(true);
    expect(app.read(FILE)).toBe(CONTENT);
  });

  test('the folder and what it held are in quarantine, not gone', async () => {
    const app = await swapped();
    await problemsOf(app, bash);
    expect(quarantined(app)).toContain(`${FILE}/inner.txt`);
    const kept = quarantine(app).filter((p) => p.endsWith(`${FILE}/inner.txt`));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(app.dataDir, 'quarantine', kept[0]), 'utf8')).toBe('the folder holds this');
    expect(logText(app)).toMatch(/Put back tests\/same\.txt, which was replaced by a folder outside the rules/);
  });

  test('the check does not lock the project: the next call runs, and finds nothing wrong', async () => {
    const app = await swapped();
    await problemsOf(app, bash);
    expectAllowed(await app.hook(post('Read', { file_path: app.abs(FILE) })));
    expect(await problemsOf(app, bash)).toEqual([]);
  });

  test('through the real hook it is blocked with the reason, and the main AI is halted for it', async () => {
    const app = await swapped();
    expectBlocked(await app.hook(bash), /tests\/same\.txt was replaced by a folder outside the rules and has been put back/);
    expect(stateOf(app).halted).toMatch(/^the main AI changed a protected file: tests\/same\.txt/);
  });

  test('an empty folder is moved aside too', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { [FILE]: CONTENT } });
    rmSync(app.abs(FILE));
    mkdirSync(app.abs(FILE));
    expect(await problemsOf(app, bash)).toEqual([`${FILE} was replaced by a folder outside the rules and has been put back (the folder was moved aside, not deleted)`]);
    expect(app.read(FILE)).toBe(CONTENT);
    expect(quarantine(app).some((p) => p.endsWith(FILE))).toBe(true);
  });

  test('after a file tool (the quick pass) as after a command', async () => {
    const app = await swapped();
    const problems = await problemsOf(app, post('Read', { file_path: 'x' }));
    expect(problems.some((p) => p.startsWith(`${FILE} was replaced by a folder`))).toBe(true);
    expect(app.read(FILE)).toBe(CONTENT);
  });

  test('a folder where a recorded plan.json was: the hook puts the plan back without deleting what the folder held', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const plan = app.read('plan/plan.json');
    rmSync(app.abs('plan/plan.json'));
    mkdirSync(app.abs('plan/plan.json'));
    writeFileSync(join(app.abs('plan/plan.json'), 'inner.txt'), 'the folder holds this');
    expectBlocked(await app.hook(bash), /plan\/plan\.json/);
    expect(app.read('plan/plan.json')).toBe(plan);
    expect(quarantine(app).filter((p) => p.endsWith('inner.txt')).length).toBeGreaterThan(0);
    const kept = quarantine(app).filter((p) => p.endsWith('inner.txt'));
    expect(readFileSync(join(app.dataDir, 'quarantine', kept[0]), 'utf8')).toBe('the folder holds this');
  });

  test('and for the settings file Claude Code writes: a folder there is put back, and halts, without being read', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { '.claude/settings.local.json': '' } });
    rmSync(app.abs('.claude/settings.local.json'));
    mkdirSync(app.abs('.claude/settings.local.json'));
    const problems = await problemsOf(app, bash);
    expect(problems.some((p) => p.includes('.claude/settings.local.json was replaced by a folder'))).toBe(true);
    expect(statSync(app.abs('.claude/settings.local.json')).isFile()).toBe(true);
    expect(stateOf(app).halted).not.toBeNull();
  });
});
