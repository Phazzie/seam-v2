// What the snapshot records and what it leaves out, and accepting one file after a legitimate change.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { acceptChange, snapshotProtected } from '../../src/guard/tamper.ts';
import { isOwn } from '../../src/guard/tamperwalk.ts';
import { makeApp } from '../helpers/app.ts';
import { post } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';
import { ctxOf, problemsOf, recordDir, recordOf } from '../helpers/tamper.ts';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const bash = post('Bash', { command: 'echo hi' });

describe('snapshotProtected', () => {
  test('records every protected file with its hash, size and time, and keeps a copy named by the hash', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const { files } = recordOf(app);
    expect(Object.keys(files).sort()).toEqual(['.seam/env.json', '.seam/lock.json', 'plan/plan.json', TOTAL, 'src/greeting/Greeting.tsx'].sort());
    const plan = files['plan/plan.json'];
    expect(plan).toEqual({ hash: sha(app.read('plan/plan.json')), size: Buffer.byteLength(app.read('plan/plan.json')), mtimeMs: expect.any(Number) });
    expect(readFileSync(join(recordDir(app), 'blobs', plan.hash), 'utf8')).toBe(app.read('plan/plan.json'));
  });

  test('leaves out what the guard itself writes, git, and node_modules', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    for (const [rel, text] of Object.entries({
      '.seam/log.md': 'x', '.seam/heartbeat.json': '{}', '.seam/state.json.1.ab.tmp': 'x',
      '.seam/inflight': '[]', 'node_modules/pkg/package.json': '{}', 'node_modules/pkg/index.js': 'x', '.git/hooks/pre-commit': 'x',
    })) app.writeRaw(rel, text);
    snapshotProtected(ctxOf(app));
    const names = Object.keys(recordOf(app).files);
    expect(names.filter((n) => /log\.md|heartbeat|\.lock|\.tmp|inflight|node_modules|^\.git|state\.json/.test(n))).toEqual([]);
    expect(await problemsOf(app, bash)).toEqual([]);
  });

  test.each(['.seam/.lock', '.seam/.lock.break', '.seam/log.md', '.seam/heartbeat.json', '.seam/inflight', '.seam/state.json', '.seam/lock.json.12.ab12cd.tmp'])('%s is written by the guard itself and never recorded (R22)', (key) => {
    expect(isOwn(key)).toBe(true);
  });

  test.each(['.seam/lock.json', '.seam/env.json', '.seam/verdicts/a.json', 'plan/plan.json'])('%s is not', (key) => {
    expect(isOwn(key)).toBe(false);
  });

  test('env files are copied too (the data folder is the owner\'s), and are the only place their text goes', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { '.env': 'KEY=abc\n', '.env.local': 'KEY=def\n' } });
    const { files } = recordOf(app);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['.env', '.env.local']));
    expect(readFileSync(join(recordDir(app), 'blobs', files['.env'].hash), 'utf8')).toBe('KEY=abc\n');
  });

  test('code files are listed; from the lock on (or the skeleton phase) the planned ones are also copied', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { 'lib/helper.ts': 'export const h = 1;\n' } });
    const rec = recordOf(app);
    expect(rec.code).toEqual(expect.arrayContaining([TOTAL, 'src/greeting/Greeting.tsx', 'lib/helper.ts']));
    expect(rec.files['lib/helper.ts']).toBeUndefined();
    expect(rec.files[TOTAL]).toBeDefined();
    const early = await makeApp({ phase: 'plan2', snapshot: true, files: { [TOTAL]: '// early\n' } });
    expect(recordOf(early).code).toContain(TOTAL);
    expect(recordOf(early).files[TOTAL]).toBeUndefined();
  });

  test('taking it again replaces the record: what was accepted stays, and the count of unattributed changes is cleared', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('plan/NOTES.md', 'a note\n');
    snapshotProtected(ctxOf(app));
    expect(await problemsOf(app, bash)).toEqual([]);
    expect(recordOf(app).unattributed).toBe(0);
    expect(existsSync(join(recordDir(app), 'state.json'))).toBe(true);
  });
});

describe('acceptChange', () => {
  test('takes one changed file as the new truth, so the next check finds nothing', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(TOTAL, total());
    acceptChange(ctxOf(app), TOTAL);
    expect(await problemsOf(app, bash)).toEqual([]);
    expect(app.read(TOTAL)).toBe(total());
    expect(recordOf(app).files[TOTAL].hash).toBe(sha(total()));
  });

  test('takes a new file in a protected folder, and forgets a file that is gone', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    mkdirSync(app.abs('tests'), { recursive: true });
    writeFileSync(app.abs('tests/total.test.ts'), 'test("x", () => {});\n');
    acceptChange(ctxOf(app), 'tests/total.test.ts');
    expect(Object.keys(recordOf(app).files)).toContain('tests/total.test.ts');
    expect(await problemsOf(app, bash)).toEqual([]);
    rmSync(app.abs('tests/total.test.ts'));
    acceptChange(ctxOf(app), 'tests/total.test.ts');
    expect(Object.keys(recordOf(app).files)).not.toContain('tests/total.test.ts');
    expect(await problemsOf(app, bash)).toEqual([]);
  });
});
