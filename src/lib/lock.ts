// The lock that keeps parallel hooks from clashing: `.seam/.lock`, created with flag `wx`. Whoever
// reads, changes and writes a record does it inside `withLock`. A file system cannot make "this lock
// is old, so remove it" one atomic step, so the lock can in rare cases be removed from under a live
// holder. Every holder therefore checks that the lock is still its own, right after taking it and
// again before letting go, and fails loudly when it is not, instead of carrying on unguarded.
// A file call that Windows answers with "busy" is waited out within the wait limit (see lockwait.ts).
import { randomBytes } from 'node:crypto';
import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BUSY_CODES, errorCode, retryBusy } from './atomic.ts';
import { outOfTime, pause, textOrNull, whenFree } from './lockwait.ts';
import type { Budget, LockLimits } from './lockwait.ts';

export type { LockLimits } from './lockwait.ts';

export const LOCK_PATH = '.seam/.lock';

export const LOCK_LIMITS: Readonly<LockLimits> = Object.freeze({ waitMs: 5000, staleMs: 30_000 });

/** A clearing guard is kept 10 times as long as a lock before it counts as left by a crash. */
const GUARD_STALE_FACTOR = 10;
/** A lock stamped further ahead of the clock than this (the clock was set back) counts as stale. */
const FUTURE_SLACK_MS = 5000;

const LOST = 'The seam lock was cleared while this ran, so its changes may have clashed with another hook\'s; blocked to be safe.';
const LOST_AT_START = 'The seam lock was cleared right after it was taken, so this was blocked to be safe. Try again.';

/** Create the lock file holding `token`. Returns '' on success, or the code that says why not (someone has it, or Windows is busy). */
function tryCreate(file: string, token: string): string {
  let fd: number;
  try {
    fd = openSync(file, 'wx');
  } catch (err) {
    const code = errorCode(err);
    if (code === 'EEXIST' || BUSY_CODES.has(code)) return code; // taken, or about to be free: the caller waits and tries again
    if (code === 'ENOENT') throw new Error(`The seam records folder is missing (${dirname(file)}), so there is nothing to lock.`);
    throw err;
  }
  try {
    writeSync(fd, token);
  } catch (err) {
    rmSync(file, { force: true }); // do not leave an empty lock that would block everyone for 30 s
    throw err;
  } finally {
    closeSync(fd);
  }
  return '';
}

/** The text of the lock file if it exists and is stale (old, or stamped in the future); otherwise null (absent, fresh, or busy). */
function staleOwner(file: string, staleMs: number): string | null {
  try {
    const text = readFileSync(file, 'utf8');
    const age = Date.now() - statSync(file).mtimeMs;
    return age >= staleMs || age < -FUTURE_SLACK_MS ? text : null;
  } catch (err) {
    if (errorCode(err) === 'ENOENT' || BUSY_CODES.has(errorCode(err))) return null; // already gone, or busy: nothing to clear right now
    throw err;
  }
}

/**
 * If the lock is stale (its owner crashed), remove it and return true. Only one process at a time
 * should do that: it first takes `.lock.break`, then looks again, and removes the lock only if it is
 * still the same old text. While the old lock exists nobody can create a new one.
 *
 * Not airtight: each "look, then delete" is two steps. A guard left by a crash is removed after 10
 * times the lock's limit (300 s by default), and two processes doing that at once can each end up
 * holding a guard; a live holder that outlives the limit can release between the second look and the
 * delete, and a new lock made in that gap is then removed. These need a crash plus a coincidence of
 * a few milliseconds. They cannot be closed with plain files, so holders detect them instead (see top).
 */
function clearIfStale(budget: Budget): boolean {
  const { file, limits } = budget;
  const seen = staleOwner(file, limits.staleMs);
  if (seen === null) return false;
  const guard = `${file}.break`;
  if (tryCreate(guard, String(process.pid)) !== '') {
    if (staleOwner(guard, limits.staleMs * GUARD_STALE_FACTOR) !== null) whenFree(budget, () => rmSync(guard, { force: true })); // its owner crashed long ago
    return false; // someone else is clearing the lock: wait and try again
  }
  try {
    if (staleOwner(file, limits.staleMs) !== seen) return false; // changed while we took the guard
    whenFree(budget, () => rmSync(file, { force: true }));
    return true;
  } finally {
    whenFree(budget, () => rmSync(guard, { force: true }));
  }
}

/** Is the lock file still the one we made? False if it is gone or holds someone else's token. */
function stillOurs(file: string, token: string): boolean {
  return retryBusy('check the lock', () => textOrNull(file)) === token;
}

/** Wait for the lock and take it, and check it is still ours. Returns the token that marks it as ours. */
function acquire(file: string, limits: LockLimits): string {
  const token = `${process.pid} ${new Date().toISOString()} ${randomBytes(6).toString('hex')}`;
  const budget: Budget = { file, limits, deadline: Date.now() + limits.waitMs };
  for (;;) {
    const why = tryCreate(file, token);
    if (why === '') {
      if (whenFree(budget, () => textOrNull(file)) !== token) throw new Error(LOST_AT_START);
      return token;
    }
    if (clearIfStale(budget)) continue; // a dead lock is gone: try at once
    if (Date.now() >= budget.deadline) throw outOfTime(budget, why);
    pause();
  }
}

/** Let go of the lock. Throws if it is no longer ours (cleared while we ran), and then leaves it alone. */
function release(file: string, token: string): void {
  if (!stillOurs(file, token)) throw new Error(LOST);
  retryBusy('let go of the lock', () => rmSync(file, { force: true }));
}

/** `fn` threw: let go of the lock, and if that fails too, say so in the error that is thrown, which stays `fn`'s own. */
function releaseAfterError(err: unknown, file: string, token: string): unknown {
  try {
    release(file, token);
    return err;
  } catch (problem) {
    const note = (problem as Error).message;
    if (err instanceof Error) {
      err.message = `${err.message} (${note})`;
      return err;
    }
    return new Error(`${String(err)} (${note})`, { cause: err });
  }
}

/** Marks a function that returns a Promise as a type error: the lock is let go when `fn` returns, not when its Promise settles. */
type NotAPromise<T> = T extends PromiseLike<unknown> ? never : unknown;

/**
 * Run `fn` while holding the exclusive lock file `file`, and let go of it afterwards, also when
 * `fn` throws. Waits up to 5 s for another holder; a lock older than 30 s is treated as dead. If the
 * lock is found cleared or taken over (right after taking it, or when letting go), it throws a plain
 * error ("The seam lock was cleared ...") rather than carry on; when `fn` itself threw, that error
 * is `fn`'s, with the lock problem added to its message. `fn` must be synchronous (a Promise is a
 * type error) and the lock is not re-entrant. Throws if the folder that should hold `file` is missing.
 */
export function withLockFile<T>(file: string, fn: () => T & NotAPromise<T>, limits: Readonly<LockLimits> = LOCK_LIMITS): T {
  const token = acquire(file, limits);
  let result: T;
  try {
    result = fn();
  } catch (err) {
    throw releaseAfterError(err, file, token);
  }
  release(file, token);
  return result;
}

/** `withLockFile` on a project's own lock, `.seam/.lock`. Throws if `.seam/` is missing. */
export function withLock<T>(root: string, fn: () => T & NotAPromise<T>, limits: Readonly<LockLimits> = LOCK_LIMITS): T {
  return withLockFile(join(root, LOCK_PATH), fn, limits);
}
