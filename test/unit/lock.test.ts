import { existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { LOCK_LIMITS, withLock } from '../../src/lib/store.ts';
import { put, tempDir } from '../helpers/project.ts';
import { ago, lockPath, parallel, setup } from '../helpers/store-procs.ts';

const counter = (root: string): number => Number(readFileSync(join(root, '.seam', 'counter.txt'), 'utf8'));
const guardPath = (root: string): string => `${lockPath(root)}.break`;
/** Write a file in `.seam/` and make it look `age` ms old (negative: stamped in the future). */
function leftBehind(path: string, age: number): void {
  writeFileSync(path, 'left behind by a crash');
  utimesSync(path, ago(age), ago(age));
}
const SHORT = { waitMs: 250, staleMs: 30_000 };

describe('waiting, and clearing a lock left by a crash', () => {
  test('a lock older than 30 s is cleared, and nothing is left in .seam', () => {
    const { root } = setup();
    leftBehind(lockPath(root), 31_000);
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });

  test('a fresh lock held by someone else is waited for, then refused with a plain reason; the function never runs', () => {
    const { root } = setup();
    writeFileSync(lockPath(root), '1234 just now');
    let ran = false;
    const started = Date.now();
    expect(() => withLock(root, () => { ran = true; }, SHORT)).toThrow(/another seam .*\.seam[\\/]\.lock/i);
    expect(Date.now() - started).toBeGreaterThanOrEqual(230);
    expect(ran).toBe(false);
    expect(readFileSync(lockPath(root), 'utf8')).toBe('1234 just now');
  });

  test('a lock stamped far in the future (the clock was set back) counts as stale', () => {
    const { root } = setup();
    leftBehind(lockPath(root), -60_000);
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });

  test('a lock stamped only a little ahead (within 5 s) still counts as fresh', () => {
    const { root } = setup();
    leftBehind(lockPath(root), -2000);
    expect(() => withLock(root, () => 'ran', SHORT)).toThrow(/another seam/i);
  });

  test('a clearing guard younger than 10x the limit (300 s) is respected: this one waits and gives up', () => {
    const { root } = setup();
    leftBehind(lockPath(root), 60_000);
    leftBehind(guardPath(root), 200_000);
    let ran = false;
    expect(() => withLock(root, () => { ran = true; }, SHORT)).toThrow(/another seam/i);
    expect(ran).toBe(false);
  });

  test('a clearing guard older than 300 s is cleared along with the old lock', () => {
    const { root } = setup();
    leftBehind(lockPath(root), 60_000);
    leftBehind(guardPath(root), 400_000);
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });

  test('8 processes racing to clear the same stale lock still go in one at a time', { retry: 2 }, async () => {
    const { root, data } = setup();
    put(root, '.seam/counter.txt', '0');
    leftBehind(lockPath(root), 60_000);
    await parallel('incr', root, data, 8, 3);
    expect(counter(root)).toBe(24);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  test('10 processes racing over a stale lock AND a stale guard: no silent lost update, only loud ones', { retry: 2 }, async () => {
    const { root, data } = setup();
    put(root, '.seam/counter.txt', '0');
    leftBehind(lockPath(root), 60_000);
    leftBehind(guardPath(root), 400_000);
    const racers = 10;
    const results = (await parallel('incr-report', root, data, racers, 2)).map((out) => JSON.parse(out) as { error: string | null });
    const errors = results.flatMap((r) => (r.error === null ? [] : [r.error]));
    // Whatever is refused is refused with a plain reason, never a crash, a raw file system error or another failure: the
    // "lock was cleared" error, or (on a machine so loaded that a racer waits out its 5 s) the plain "gave up" one.
    for (const message of errors) expect(message).toMatch(/lock was cleared|another seam hook or command has held .* so this one gave up/i);
    if (errors.length === 0) expect(counter(root)).toBe(racers * 2);
    else expect(counter(root)).toBeLessThanOrEqual(racers * 2);
  });
});

describe('a lock that is cleared while the function runs', () => {
  test('the lock is let go when the function throws, and it is the same error', () => {
    const { root } = setup();
    const boom = new Error('boom');
    expect(() => withLock(root, () => { throw boom; })).toThrow(boom);
    expect(boom.message).toBe('boom');
    expect(existsSync(lockPath(root))).toBe(false);
    expect(withLock(root, () => 'again')).toBe('again');
  });

  test('someone else took the lock over: refused, and their lock is left alone', () => {
    const { root } = setup();
    expect(() => withLock(root, () => writeFileSync(lockPath(root), 'taken over by another process'))).toThrow(/lock was cleared/i);
    expect(readFileSync(lockPath(root), 'utf8')).toBe('taken over by another process');
  });

  test('the lock file vanished: refused', () => {
    const { root } = setup();
    expect(() => withLock(root, () => rmSync(lockPath(root)))).toThrow(/lock was cleared.*blocked to be safe/i);
  });

  test('the function threw and the lock was also cleared: its own error comes out, with the lock problem added to the message', () => {
    const { root } = setup();
    const boom = new TypeError('boom');
    let caught: unknown;
    try {
      withLock(root, () => { rmSync(lockPath(root)); throw boom; });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);
    expect(boom).toBeInstanceOf(TypeError);
    expect(boom.message).toMatch(/^boom \(.*lock was cleared/i);
  });

  test('a thrown value that is not an Error is wrapped with the lock problem, and kept as the cause', () => {
    const { root } = setup();
    let caught: unknown;
    try {
      withLock(root, () => { rmSync(lockPath(root)); throw 'plain text'; });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/^plain text \(.*lock was cleared/i);
    expect((caught as Error).cause).toBe('plain text');
  });
});

describe('other', () => {
  test('a missing .seam folder is a plain error, not a raw ENOENT', () => {
    expect(() => withLock(tempDir(), () => 1)).toThrow(/records folder is missing.*\.seam/i);
  });

  test('the default limits are 5 s and 30 s, and cannot be changed', () => {
    expect(LOCK_LIMITS).toEqual({ waitMs: 5000, staleMs: 30_000 });
    expect(Object.isFrozen(LOCK_LIMITS)).toBe(true);
  });

  test('a function that returns a Promise is a type error, a plain value is fine', () => {
    expectTypeOf<ReturnType<Parameters<typeof withLock<Promise<number>>>[1]>>().toBeNever();
    expectTypeOf<ReturnType<Parameters<typeof withLock<number>>[1]>>().toEqualTypeOf<number>();
  });
});
