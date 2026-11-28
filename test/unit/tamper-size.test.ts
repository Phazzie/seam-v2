// M-5: a changed recorded file of another size is changed, whatever is in it, so it is never read to be hashed: a
// huge replacement is put back without being read whole. (Only a file of the same size has to be hashed to be told.)
import { rmSync, statSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { hashOf } from '../../src/guard/tamperrecord.ts';
import { makeApp } from '../helpers/app.ts';
import { post } from '../helpers/calls.ts';
import { problemsOf } from '../helpers/tamper.ts';

vi.mock('../../src/guard/tamperrecord.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/guard/tamperrecord.ts')>();
  return { ...real, hashOf: vi.fn(real.hashOf) };
});

const TEST_FILE = 'tests/total.test.ts';
beforeEach(() => {
  vi.mocked(hashOf).mockClear();
});

/** The files the check has read to hash them. */
const hashed = (): string[] => vi.mocked(hashOf).mock.calls.map(([path]) => String(path).replaceAll('\\', '/'));

describe('a changed file of another size is not hashed', () => {
  test.each([['Read', 'the quick pass'], ['Bash', 'the full pass']])('after %s (%s) a 3 MB file in place of a small one is put back, with no hash taken', async (tool) => {
    const app = await makeApp({ phase: 'build', lock: true, files: { [TEST_FILE]: 'test("x", () => {});\n' } });
    writeFileSync(app.abs(TEST_FILE), Buffer.alloc(3 * 1024 * 1024, 0x61));
    expect(await problemsOf(app, post(tool, { file_path: 'x' }))).toEqual([`${TEST_FILE} was changed outside the rules and has been put back`]);
    expect(statSync(app.abs(TEST_FILE)).size).toBe(Buffer.byteLength('test("x", () => {});\n'));
    expect(hashed().filter((path) => path.endsWith(TEST_FILE))).toEqual([]);
  });

  test('a change that keeps the size does have to be hashed, to be told (the control)', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { [TEST_FILE]: 'test("x", () => {});\n' } });
    app.writeRaw(TEST_FILE, 'test("y", () => {});\n');
    expect(await problemsOf(app, post('Bash', { command: 'x' }))).toEqual([`${TEST_FILE} was changed outside the rules and has been put back`]);
    expect(hashed().filter((path) => path.endsWith(TEST_FILE)).length).toBeGreaterThan(0);
  });

  test('a deleted file is put back without any hash either', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { [TEST_FILE]: 'test("x", () => {});\n' } });
    rmSync(app.abs(TEST_FILE));
    expect(await problemsOf(app, post('Read', { file_path: 'x' }))).toEqual([`${TEST_FILE} was deleted outside the rules and has been put back`]);
    expect(hashed()).toEqual([]);
  });
});
