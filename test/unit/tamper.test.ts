// The tamper check: what it finds after a tool ran, what it puts back, and what it moves aside.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { snapshotProtected } from '../../src/guard/tamper.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { post } from '../helpers/calls.ts';
import { call, reasonOf } from '../helpers/inproc.ts';
import { TOTAL, total } from '../helpers/code.ts';
import { ctxOf, logText, longerPlan, problemsOf, quarantined, recordDir, samePlan, stateOf } from '../helpers/tamper.ts';
import type { Saved } from '../helpers/tamper.ts';

const bash = post('Bash', { command: 'echo hi' });
const PLAN = 'plan/plan.json';

describe('an unchanged project', () => {
  test.each([['Bash', bash], ['Read', post('Read', { file_path: 'x' })], ['an MCP tool', post('mcp__x__y', {})]])('after %s there is nothing to report', async (_name, input) => {
    const app = await makeApp({ phase: 'build', lock: true });
    expect(await problemsOf(app, input)).toEqual([]);
    expect(stateOf(app).halted).toBeNull();
    expect(logText(app)).toBe('');
  });

  test('a project that was never snapshotted (no lock either) is left alone', async () => {
    const app = await makeApp({ phase: 'plan1' });
    app.writeRaw(PLAN, longerPlan(app));
    expect(await problemsOf(app, bash)).toEqual([]);
  });

  test('a lock with no record of the protected files is a block, in the words of a failure', async () => {
    const app = await makeApp({ phase: 'build', lock: true, snapshot: false });
    const [problem] = await problemsOf(app, bash);
    expect(problem).toMatch(/blocked to be safe/);
  });
});

describe('what the guard does when it cannot do its own work', () => {
  test('a record of the protected files that is not valid JSON is a refusal in the words of a failure, never an allow', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    writeFileSync(join(recordDir(app), 'protected.json'), '{ broken');
    const reason = reasonOf(await call(app, post('Bash', { command: 'echo hi' })));
    expect(reason).toMatch(/blocked to be safe/);
    expect(reason).toMatch(/record of the protected files/);
  });

  test('a note of calls under way that is unreadable is started again, and the log says so', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('.seam/inflight', 'not json');
    expect(await problemsOf(app, bash)).toEqual([]);
    expect(logText(app)).toMatch(/calls under way could not be read/);
  });
});

describe('a protected file changed behind the guard', () => {
  test('a changed plan.json is put back and reported plainly', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const original = app.read(PLAN);
    app.writeRaw(PLAN, longerPlan(app));
    expect(await problemsOf(app, bash)).toEqual(['plan/plan.json was changed outside the rules and has been put back']);
    expect(app.read(PLAN)).toBe(original);
    expect(await problemsOf(app, bash)).toEqual([]);
  });

  test.each(['.claude/settings.json', 'package.json', 'contracts/order.ts', 'tests/total.test.ts', 'fixtures/orders.json', 'CLAUDE.md', '.github/workflows/ci.yml', '.seam/verdicts/a.json', '.gitignore'])('a changed %s is put back (every protected place is covered)', async (path) => {
    const app = await makeApp({ phase: 'build', lock: true, files: { [path]: 'original\n' } });
    app.writeRaw(path, 'changed\n');
    expect(await problemsOf(app, bash)).toEqual([`${path} was changed outside the rules and has been put back`]);
    expect(app.read(path)).toBe('original\n');
  });

  test('a deleted lock.json is put back', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const original = app.read('.seam/lock.json');
    rmSync(app.abs('.seam/lock.json'));
    expect(await problemsOf(app, bash)).toEqual(['.seam/lock.json was deleted outside the rules and has been put back']);
    expect(app.read('.seam/lock.json')).toBe(original);
  });

  test('a locked code file overwritten through a command is put back (R15 and cheat 2)', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const skeleton = app.read(TOTAL);
    app.writeRaw(TOTAL, total());
    expect(await problemsOf(app, bash)).toEqual([`${TOTAL} was changed outside the rules and has been put back`]);
    expect(app.read(TOTAL)).toBe(skeleton);
  });

  test('a skeleton written before the lock is protected from the skeleton phase on (R15)', async () => {
    const app = await makeApp({ phase: 'skeleton', snapshot: false });
    app.writeRaw(TOTAL, '// a skeleton\n');
    snapshotProtected(ctxOf(app));
    app.writeRaw(TOTAL, total());
    expect(await problemsOf(app, bash)).toEqual([`${TOTAL} was changed outside the rules and has been put back`]);
    expect(app.read(TOTAL)).toBe('// a skeleton\n');
  });

  test('a deleted file is put back, folder and all', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const original = app.read(TOTAL);
    rmSync(app.abs('src/pricing'), { recursive: true });
    expect(await problemsOf(app, bash)).toEqual([`${TOTAL} was deleted outside the rules and has been put back`]);
    expect(app.read(TOTAL)).toBe(original);
  });

  test('state.json changed to clear the halt is put back from the copy in the data folder', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const original = app.read('.seam/state.json');
    app.writeRaw('.seam/state.json', original.replace('"blocks": 0', '"blocks": 9'));
    expect(await problemsOf(app, bash)).toEqual(['.seam/state.json was changed outside the rules and has been put back']);
    expect(JSON.parse(app.read('.seam/state.json')).blocks).toBe(0);
  });

  test('the log says it in words and never holds what was in the file', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { '.env': 'KEY=hunter2-secret\n' } });
    app.writeRaw('.env', 'KEY=other-secret\n');
    expect(await problemsOf(app, bash)).toEqual(['.env was changed outside the rules and has been put back']);
    expect(app.read('.env')).toBe('KEY=hunter2-secret\n');
    expect(logText(app)).toMatch(/\.env/);
    expect(logText(app)).not.toMatch(/secret/);
  });
});

describe('a new file that has no place there', () => {
  test('a new code file outside the plan is moved aside, with its content kept', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('lib/stash.ts', 'export const stash = 1;\n');
    expect(await problemsOf(app, bash)).toEqual([expect.stringMatching(/^lib\/stash\.ts .*moved aside/)]);
    expect(existsSync(app.abs('lib/stash.ts'))).toBe(false);
    expect(quarantined(app)).toEqual(['lib/stash.ts']);
  });

  test('a planned code file that was not there at the snapshot is moved aside too (c02)', async () => {
    const app = await makeApp({ phase: 'skeleton', snapshot: true });
    app.writeRaw(TOTAL, total());
    expect(await problemsOf(app, bash)).toEqual([expect.stringMatching(/^src\/pricing\/total\.ts .*moved aside/)]);
    expect(existsSync(app.abs(TOTAL))).toBe(false);
  });

  test('a 3 MB binary dropped in tests/ is moved aside without being read, and nothing throws', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const big = Buffer.alloc(3 * 1024 * 1024, 0xff);
    big[10] = 0;
    app.writeRaw('tests/blob.bin', '');
    writeFileSync(app.abs('tests/blob.bin'), big);
    expect(await problemsOf(app, bash)).toEqual([expect.stringMatching(/^tests\/blob\.bin .*moved aside/)]);
    expect(existsSync(app.abs('tests/blob.bin'))).toBe(false);
    expect(statSync(join(app.dataDir, 'quarantine', readdirOne(app), 'tests/blob.bin')).size).toBe(big.length);
  });

  test('a new file in a protected folder is moved aside; a note or a git-ignored file is not', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { '.gitignore': 'scratch.ts\n' } });
    app.writeRaw('tests/new.test.ts', 'test("x", () => {});\n');
    app.writeRaw('notes.md', 'hello\n');
    app.writeRaw('scratch.ts', 'export {};\n');
    expect((await problemsOf(app, bash)).map((p) => p.split(' ')[0])).toEqual(['tests/new.test.ts']);
    expect(existsSync(app.abs('notes.md')) && existsSync(app.abs('scratch.ts'))).toBe(true);
    expect(await problemsOf(app, bash)).toEqual([]);
  });
});

describe('which tools get the quick check and which the full one (15.17)', () => {
  /**
   * Change plan.json without changing its size, and make the record believe its modified time is the new one: only a
   * hash can see the change (a command can set a file's time to what it likes, and a clock only goes so fine).
   */
  function sneak(app: App): void {
    writeFileSync(app.abs(PLAN), samePlan(app));
    const file = join(recordDir(app), 'protected.json');
    const rec = JSON.parse(readFileSync(file, 'utf8')) as Saved;
    rec.files[PLAN].mtimeMs = statSync(app.abs(PLAN)).mtimeMs;
    writeFileSync(file, JSON.stringify(rec));
  }

  test('after a file tool, a change that keeps size and time is not looked for', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    sneak(app);
    expect(await problemsOf(app, post('Read', { file_path: app.abs('notes.md') }))).toEqual([]);
  });

  test.each(['Bash', 'PowerShell', 'mcp__some__tool', 'SomethingNew'])('after %s every protected file is hashed, so that change is found', async (tool) => {
    const app = await makeApp({ phase: 'build', lock: true });
    sneak(app);
    expect(await problemsOf(app, post(tool, {}))).toEqual(['plan/plan.json was changed outside the rules and has been put back']);
    expect(app.read(PLAN)).toContain('"react"]');
  });

  test.each(['Read', 'Glob', 'Grep', 'Edit', 'Write'])('after %s a change of size is found at once', async (tool) => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(PLAN, longerPlan(app));
    expect(await problemsOf(app, post(tool, { file_path: app.abs('notes.md') }))).toEqual(['plan/plan.json was changed outside the rules and has been put back']);
  });
});

const readdirOne = (app: App): string => readdirSync(join(app.dataDir, 'quarantine'))[0];
