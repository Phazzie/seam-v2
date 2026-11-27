import { closeSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { withLock } from '../../src/lib/store.ts';
import { lockPath, setup } from '../helpers/store-procs.ts';

// The lock is checked right after it is taken, before the function runs. To catch a lock that is
// cleared in that instant, the file call that finishes taking it is made to clear it on purpose.
const real = await vi.importActual<typeof import('node:fs')>('node:fs');
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, closeSync: vi.fn(actual.closeSync) };
});
afterEach(() => vi.mocked(closeSync).mockImplementation(real.closeSync));

describe('the check right after taking the lock', () => {
  test('a lock that is gone by then blocks the run: the function never runs', () => {
    const { root } = setup();
    vi.mocked(closeSync).mockImplementationOnce((fd) => {
      real.closeSync(fd);
      real.rmSync(lockPath(root));
    });
    let ran = false;
    expect(() => withLock(root, () => { ran = true; })).toThrow(/lock was cleared right after it was taken/i);
    expect(ran).toBe(false);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  test('a lock that someone else owns by then blocks the run, and their lock is left alone', () => {
    const { root } = setup();
    vi.mocked(closeSync).mockImplementationOnce((fd) => {
      real.closeSync(fd);
      writeFileSync(lockPath(root), 'someone else, just now');
    });
    let ran = false;
    expect(() => withLock(root, () => { ran = true; })).toThrow(/lock was cleared right after it was taken/i);
    expect(ran).toBe(false);
    expect(readFileSync(lockPath(root), 'utf8')).toBe('someone else, just now');
  });
});
