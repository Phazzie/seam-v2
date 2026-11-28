// Making the lock file takes two steps: create it, then write the owner's token into it. When the write fails (a full
// disk) the empty lock must not be left to block every hook for 30 s, and when removing it fails too, that must not hide
// the write failure: it is the write error that comes out, with the removal problem added to its message.
import { closeSync, existsSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { withLock } from '../../src/lib/lock.ts';
import { lockPath, setup } from '../helpers/store-procs.ts';

const real = await vi.importActual<typeof import('node:fs')>('node:fs');
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeSync: vi.fn(actual.writeSync), closeSync: vi.fn(actual.closeSync), rmSync: vi.fn(actual.rmSync) };
});
afterEach(() => {
  vi.mocked(writeSync).mockImplementation(real.writeSync);
  vi.mocked(closeSync).mockImplementation(real.closeSync);
  vi.mocked(rmSync).mockImplementation(real.rmSync);
  vi.mocked(rmSync).mockClear();
  vi.mocked(closeSync).mockClear();
});

const fail = (code: string, what: string): never => {
  throw Object.assign(new Error(`${code}: ${what}`), { code });
};

/** The next write to the lock file fails: the disk is full. */
const diskFull = (): void => void vi.mocked(writeSync).mockImplementationOnce((() => fail('ENOSPC', 'no space left on device, write')) as typeof writeSync);

/** Removing the lock file fails with `code` for the next `times` calls; every other removal is real. */
function lockRemovalFails(code: string, times: number): { hits: () => number } {
  let hits = 0;
  vi.mocked(rmSync).mockImplementation(((path: Parameters<typeof rmSync>[0], options?: Parameters<typeof rmSync>[1]) => {
    if (String(path).endsWith('.lock') && hits < times) {
      hits += 1;
      fail(code, 'operation not permitted, unlink');
    }
    return real.rmSync(path, options);
  }) as typeof rmSync);
  return { hits: () => hits };
}

/** Calls of `rmSync` on the lock file, as the order in which they ran (to compare with the close). */
const lockRemovalOrder = (): number[] =>
  vi.mocked(rmSync).mock.calls.flatMap((call, i) => (String(call[0]).endsWith('.lock') ? [vi.mocked(rmSync).mock.invocationCallOrder[i]] : []));

describe('the write of the token into a new lock file fails', () => {
  test('the error is the write error, the function never runs and no empty lock is left behind', () => {
    const { root } = setup();
    diskFull();
    let ran = false;
    expect(() => withLock(root, () => { ran = true; })).toThrow(/^ENOSPC: no space left on device, write$/);
    expect(ran).toBe(false);
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
    expect(withLock(root, () => 'again')).toBe('again'); // the next hook is not blocked
  });

  test('the file is closed before it is removed', () => {
    const { root } = setup();
    diskFull();
    expect(() => withLock(root, () => 'x')).toThrow(/ENOSPC/);
    const closedAt = vi.mocked(closeSync).mock.invocationCallOrder[0];
    expect(lockRemovalOrder().length).toBeGreaterThan(0);
    expect(closedAt).toBeLessThan(lockRemovalOrder()[0]);
  });

  test('a busy removal is waited out, and the error carries no extra note', () => {
    const { root } = setup();
    diskFull();
    const removal = lockRemovalFails('EBUSY', 2);
    expect(() => withLock(root, () => 'x')).toThrow(/^ENOSPC: no space left on device, write$/);
    expect(removal.hits()).toBe(2);
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });

  test('a removal that never works does not hide the write error: it comes first, with the removal problem added', () => {
    const { root } = setup();
    diskFull();
    lockRemovalFails('EPERM', Number.MAX_SAFE_INTEGER);
    let caught: unknown;
    try {
      withLock(root, () => 'x');
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toMatch(/^ENOSPC: no space left on device, write \(Could not remove .*\.lock: it stayed busy/i);
    expect(existsSync(lockPath(root))).toBe(true); // left behind, and the message says so
  });

  test('a close that fails does not stop the removal, and does not hide the write error either', () => {
    const { root } = setup();
    diskFull();
    vi.mocked(closeSync).mockImplementationOnce(((fd: number) => { real.closeSync(fd); fail('EIO', 'i/o error, close'); }) as typeof closeSync);
    let caught: unknown;
    try {
      withLock(root, () => 'x');
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe('ENOSPC: no space left on device, write (EIO: i/o error, close)');
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });
});
