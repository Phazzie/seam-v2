import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { atomicWrite, RETRY_PAUSE_MS, RETRY_TRIES } from '../../src/lib/atomic.ts';
import { tempDir } from '../helpers/project.ts';

// Windows refuses to rename onto a file another process has open (EPERM, EBUSY or EACCES), so
// the retry is tested by making the real rename fail on purpose.
const real = await vi.importActual<typeof import('node:fs')>('node:fs');
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
afterEach(() => vi.mocked(renameSync).mockImplementation(real.renameSync));

const failing = (code: string) => (): never => {
  throw Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
};

function setup(): { target: string; dir: string } {
  const dir = tempDir();
  const target = join(dir, 'state.json');
  writeFileSync(target, 'old\n');
  return { target, dir };
}

describe('atomicWrite', () => {
  test('replaces the file and leaves no temp file', () => {
    const { target, dir } = setup();
    atomicWrite(target, 'new\n');
    expect(readFileSync(target, 'utf8')).toBe('new\n');
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  test('creates the file when there was none', () => {
    const dir = tempDir();
    atomicWrite(join(dir, 'fresh.json'), 'x');
    expect(readFileSync(join(dir, 'fresh.json'), 'utf8')).toBe('x');
  });

  test.each(['EPERM', 'EBUSY', 'EACCES'])('a rename that fails with %s is tried again and then succeeds', (code) => {
    const { target } = setup();
    vi.mocked(renameSync).mockClear();
    vi.mocked(renameSync).mockImplementationOnce(failing(code)).mockImplementationOnce(failing(code));
    const started = Date.now();
    atomicWrite(target, 'new\n');
    expect(readFileSync(target, 'utf8')).toBe('new\n');
    expect(renameSync).toHaveBeenCalledTimes(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(RETRY_PAUSE_MS);
  });

  test('keeps failing: gives up after the set number of tries, says why, keeps the old file, removes the temp file', () => {
    const { target, dir } = setup();
    vi.mocked(renameSync).mockClear();
    vi.mocked(renameSync).mockImplementation(failing('EPERM'));
    expect(() => atomicWrite(target, 'new\n')).toThrow(new RegExp(`could not replace .*state\\.json: it stayed busy for ${(RETRY_TRIES - 1) * RETRY_PAUSE_MS} ms \\(EPERM`, 'is'));
    expect(renameSync).toHaveBeenCalledTimes(RETRY_TRIES);
    expect(readFileSync(target, 'utf8')).toBe('old\n');
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  test('any other error is not retried and is not hidden; the old file stays and the temp file goes', () => {
    const { target, dir } = setup();
    vi.mocked(renameSync).mockClear();
    vi.mocked(renameSync).mockImplementation(failing('EXDEV'));
    expect(() => atomicWrite(target, 'new\n')).toThrow(/EXDEV/);
    expect(renameSync).toHaveBeenCalledTimes(1);
    expect(readFileSync(target, 'utf8')).toBe('old\n');
    expect(readdirSync(dir)).toEqual(['state.json']);
  });
});
