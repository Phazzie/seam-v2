// On Windows a create, a remove or a read of the lock file can fail for a moment (EPERM, EBUSY, EACCES) while
// another process is using it. These tests make `node:fs` throw those answers a few times on one call and show
// the lock waits and tries again, and that a file system that never stops being busy ends in the plain
// "gave up" message and never in the raw error.
import { readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { withLock } from '../../src/lib/lock.ts';
import { ago, lockPath, setup } from '../helpers/store-procs.ts';

type Call = 'openSync' | 'readFileSync' | 'rmSync';
interface Fault { call: Call; suffix: string; left: number; code: string; hits: number }
const state = vi.hoisted(() => ({ fault: null as Fault | null }));

/** Throws the injected error when `call` is the faulty one, the path ends with the faulty suffix and some faults are left. */
function injected(call: Call, path: unknown): void {
  const fault = state.fault;
  if (fault === null || fault.call !== call || fault.left <= 0 || !String(path).endsWith(fault.suffix)) return;
  fault.left -= 1;
  fault.hits += 1;
  throw Object.assign(new Error(`${fault.code}, operation not permitted (injected)`), { code: fault.code });
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: ((...args: Parameters<typeof actual.openSync>) => { injected('openSync', args[0]); return actual.openSync(...args); }) as typeof actual.openSync,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => { injected('readFileSync', args[0]); return actual.readFileSync(...args); }) as typeof actual.readFileSync,
    rmSync: ((...args: Parameters<typeof actual.rmSync>) => { injected('rmSync', args[0]); return actual.rmSync(...args); }) as typeof actual.rmSync,
  };
});

/** The next `times` calls of `call` on a path ending in `suffix` fail with `code`. */
function failing(call: Call, suffix: string, times: number, code = 'EPERM'): Fault {
  state.fault = { call, suffix, left: times, code, hits: 0 };
  return state.fault;
}
const SHORT = { waitMs: 300, staleMs: 30_000 };
const RAW = /Permission denied|operation not permitted|injected/i;

beforeEach(() => { state.fault = null; });
afterEach(() => { state.fault = null; });

describe('Windows answering "busy" is waited out, not thrown', () => {
  test.each(['EPERM', 'EBUSY', 'EACCES'])('creating the lock: %s three times, then it is taken and the function runs', (code) => {
    const { root } = setup();
    const fault = failing('openSync', '.lock', 3, code);
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(fault.hits).toBe(3);
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });

  test('checking that the lock is ours right after taking it: EPERM three times, then it is checked and the function runs', () => {
    const { root } = setup();
    const fault = failing('readFileSync', '.lock', 3);
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(fault.hits).toBe(3);
  });

  test('letting go of the lock: EPERM once, then it is removed', () => {
    const { root } = setup();
    const fault = failing('rmSync', '.lock', 1);
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(fault.hits).toBe(1);
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });

  test('clearing a stale lock: EPERM on removing it twice, then it is cleared and the function runs', () => {
    const { root } = setup();
    writeFileSync(lockPath(root), 'left behind by a crash');
    utimesSync(lockPath(root), ago(31_000), ago(31_000));
    const fault = failing('rmSync', '.lock', 2);
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(fault.hits).toBe(2);
    expect(readdirSync(join(root, '.seam'))).toEqual([]); // the lock and the clearing guard are both gone
  });

  test('clearing a stale lock: EBUSY on letting go of the clearing guard, then it is removed and nothing is left', () => {
    const { root } = setup();
    writeFileSync(lockPath(root), 'left behind by a crash');
    utimesSync(lockPath(root), ago(31_000), ago(31_000));
    const fault = failing('rmSync', '.lock.break', 2, 'EBUSY');
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(fault.hits).toBe(2);
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });

  test('clearing a stale clearing guard left by a crash: EPERM once, then it is cleared along with the lock', () => {
    const { root } = setup();
    for (const [path, age] of [[lockPath(root), 60_000], [`${lockPath(root)}.break`, 400_000]] as const) {
      writeFileSync(path, 'left behind by a crash');
      utimesSync(path, ago(age), ago(age));
    }
    const fault = failing('rmSync', '.lock.break', 1);
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(fault.hits).toBe(1);
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });
});

describe('a file system that stays busy past the wait limit fails closed with the plain message', () => {
  test('creating: the function never runs, and the error is the "gave up" one with the code, not the raw error', () => {
    const { root } = setup();
    failing('openSync', '.lock', Number.MAX_SAFE_INTEGER);
    let ran = false;
    const started = Date.now();
    let message = '';
    try {
      withLock(root, () => { ran = true; }, SHORT);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/another seam hook or command has held .*\.lock for 0\.3 s, so this one gave up \(the file system kept answering EPERM\)/i);
    expect(message).not.toMatch(RAW);
    expect(Date.now() - started).toBeGreaterThanOrEqual(270);
    expect(ran).toBe(false);
  });

  test('checking the lock right after taking it: the same plain message', () => {
    const { root } = setup();
    failing('readFileSync', '.lock', Number.MAX_SAFE_INTEGER, 'EACCES');
    let ran = false;
    let message = '';
    try {
      withLock(root, () => { ran = true; }, SHORT);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/gave up \(the file system kept answering EACCES\)/i);
    expect(message).not.toMatch(RAW);
    expect(ran).toBe(false);
  });

  test('clearing a stale lock: the same plain message, and the function never runs', () => {
    const { root } = setup();
    writeFileSync(lockPath(root), 'left behind by a crash');
    utimesSync(lockPath(root), ago(31_000), ago(31_000));
    failing('rmSync', '.lock', Number.MAX_SAFE_INTEGER, 'EBUSY');
    let ran = false;
    let message = '';
    try {
      withLock(root, () => { ran = true; }, SHORT);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/gave up \(the file system kept answering EBUSY\)/i);
    expect(message).not.toMatch(RAW);
    expect(ran).toBe(false);
  });
});
