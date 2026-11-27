// Waiting for the lock file. On Windows a create, a remove or a read can fail for a moment (EPERM, EBUSY,
// EACCES) while another process is using the same file. Those answers mean "busy": wait and try again
// within the wait limit, and when it runs out say so in the plain "gave up" message, never with the raw
// file system error. Anything else a file call throws is thrown as it is.
import { readFileSync } from 'node:fs';
import { BUSY_CODES, errorCode, sleepMs } from './atomic.ts';

/** How long to wait for the lock, and how old a lock must be before it counts as left by a crash. */
export interface LockLimits {
  readonly waitMs: number;
  readonly staleMs: number;
}

/** What one attempt to take the lock has to go on: the file, the limits, and when the waiting ends. */
export interface Budget {
  readonly file: string;
  readonly limits: LockLimits;
  readonly deadline: number;
}

/** A different pause each time, so waiting processes do not move in step. */
export const pause = (): void => sleepMs(5 + Math.floor(Math.random() * 15));

/** The error for waiting out the whole limit. `why` is the busy code the file system kept answering, or 'EEXIST' for a lock that is simply held. */
export function outOfTime({ file, limits }: Budget, why: string): Error {
  const detail = why === 'EEXIST' ? '' : ` (the file system kept answering ${why})`;
  return new Error(
    `Another seam hook or command has held ${file} for ${limits.waitMs / 1000} s, so this one gave up${detail}. ` +
    `If none is running, the lock clears by itself once it is ${limits.staleMs / 1000} s old, or delete that file.`,
  );
}

/** Do a file call on the lock, trying again while Windows answers busy. When the time is up it throws the plain "gave up" error. */
export function whenFree<T>(budget: Budget, op: () => T): T {
  for (;;) {
    try {
      return op();
    } catch (err) {
      const code = errorCode(err);
      if (!BUSY_CODES.has(code)) throw err;
      if (Date.now() >= budget.deadline) throw outOfTime(budget, code);
    }
    pause();
  }
}

/** The text of `file`, or null if it is not there. A busy answer is thrown, for the caller to wait out. */
export function textOrNull(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    throw err;
  }
}
