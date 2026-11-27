import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { afterError, atomicWrite, RETRY_PAUSE_MS, RETRY_TRIES } from '../../src/lib/atomic.ts';
import { tempDir } from '../helpers/project.ts';

// Windows refuses to rename onto a file another process has open (EPERM, EBUSY or EACCES), so
// the retry is tested by making the real rename fail on purpose.
const real = await vi.importActual<typeof import('node:fs')>('node:fs');
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), rmSync: vi.fn(actual.rmSync) };
});
afterEach(() => {
  vi.mocked(renameSync).mockImplementation(real.renameSync);
  vi.mocked(rmSync).mockImplementation(real.rmSync);
});

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

/** Removing a temp file (a path ending in .tmp) fails with `code` for the next `times` calls; every other removal is real. */
function tempFileRemovalFails(code: string, times: number): { hits: () => number } {
  let hits = 0;
  vi.mocked(rmSync).mockImplementation(((path: Parameters<typeof rmSync>[0], options?: Parameters<typeof rmSync>[1]) => {
    if (String(path).endsWith('.tmp') && hits < times) {
      hits += 1;
      throw Object.assign(new Error(`${code}: operation not permitted, unlink`), { code });
    }
    return real.rmSync(path, options);
  }) as typeof rmSync);
  return { hits: () => hits };
}

describe('atomicWrite when the write fails and the temp file cannot be removed at once', () => {
  test('a busy removal is waited out, so the temp file is gone and the error is the original, unchanged', () => {
    const { target, dir } = setup();
    vi.mocked(renameSync).mockImplementation(failing('EXDEV'));
    const removal = tempFileRemovalFails('EBUSY', 2);
    expect(() => atomicWrite(target, 'new\n')).toThrow(/^EXDEV: operation not permitted, rename$/);
    expect(removal.hits()).toBe(2);
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  test('a removal that never works does not hide the write error: it comes out first, with the removal problem added', () => {
    const { target, dir } = setup();
    vi.mocked(renameSync).mockImplementation(failing('EXDEV'));
    tempFileRemovalFails('EPERM', Number.MAX_SAFE_INTEGER);
    let caught: unknown;
    try {
      atomicWrite(target, 'new\n');
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toMatch(/^EXDEV: operation not permitted, rename \(Could not remove .*\.tmp: it stayed busy/i);
    expect(readFileSync(target, 'utf8')).toBe('old\n');
    expect(readdirSync(dir)).toHaveLength(2); // the temp file is left, and the message says so
  });
});

describe('afterError', () => {
  test('a cleanup that works returns the very same error', () => {
    const boom = new Error('boom');
    expect(afterError(boom, () => undefined)).toBe(boom);
    expect(boom.message).toBe('boom');
  });

  test('a cleanup that fails adds its problem to the message of an Error, and keeps that Error', () => {
    const boom = new TypeError('boom');
    const out = afterError(boom, () => { throw new Error('cleanup broke'); });
    expect(out).toBe(boom);
    expect(boom.message).toBe('boom (cleanup broke)');
  });

  test('a thrown value that is not an Error is wrapped with the problem, and kept as the cause', () => {
    const out = afterError('plain text', () => { throw new Error('cleanup broke'); });
    expect(out).toBeInstanceOf(Error);
    expect((out as Error).message).toBe('plain text (cleanup broke)');
    expect((out as Error).cause).toBe('plain text');
  });
});
