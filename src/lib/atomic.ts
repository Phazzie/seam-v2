// Writing a file so that another process never sees half of it: write a temp file next to it, then
// rename it into place. On Windows a rename onto a file that another process has open fails for a
// moment (EPERM, EBUSY or EACCES), so it is tried again a few times. There is no fallback to a plain
// write: if the rename never works, the write fails and says so.
import { randomBytes } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';

export const RETRY_TRIES = 10;
export const RETRY_PAUSE_MS = 20;
/** Errors that mean "busy right now", which on Windows usually pass within a few milliseconds. */
export const BUSY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** The error code (`ENOENT`, `EPERM`, ...) of something a file call threw, or '' if it has none. */
export function errorCode(err: unknown): string {
  return (err as NodeJS.ErrnoException).code ?? '';
}

/** Wait without spinning. Hooks are short synchronous scripts, so this blocks the one thread on purpose. */
export function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Do a file operation, trying again while it fails as busy. Any other error is thrown at once. After
 * RETRY_TRIES busy answers it throws a plain error ("Could not <what>") that keeps the last one as its cause.
 */
export function retryBusy<T>(what: string, op: () => T): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return op();
    } catch (err) {
      if (!BUSY_CODES.has(errorCode(err))) throw err;
      if (attempt >= RETRY_TRIES) {
        throw new Error(`Could not ${what}: it stayed busy for ${(RETRY_TRIES - 1) * RETRY_PAUSE_MS} ms (${(err as Error).message}).`, { cause: err });
      }
    }
    sleepMs(RETRY_PAUSE_MS);
  }
}

/**
 * `err` was thrown and `cleanup` has to run before it goes on: run it, and return what to throw. That is `err` itself, or,
 * when the cleanup failed too, `err` with the cleanup's problem added to its message (a value that is not an Error is wrapped,
 * and kept as the cause). A failed cleanup never replaces the error that started it.
 */
export function afterError(err: unknown, cleanup: () => void): unknown {
  try {
    cleanup();
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

/** Remove a file that is no longer needed, waiting out a busy answer. (`rmSync`'s own `maxRetries` is ignored by Node unless the removal is recursive.) */
export function removeFile(file: string): void {
  retryBusy(`remove ${file}`, () => rmSync(file, { force: true }));
}

/** Replace `file` with `text` (or bytes) in one step. A reader sees the old content or the new content, never a mix. */
export function atomicWrite(file: string, text: string | Uint8Array): void {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, text);
    retryBusy(`replace ${file}`, () => renameSync(temp, file));
  } catch (err) {
    throw afterError(err, () => removeFile(temp));
  }
}
