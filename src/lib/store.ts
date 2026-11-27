// The state store: the lock that keeps parallel hooks from clashing, and reading and writing
// `.seam/state.json` (with its copy in the data folder). Hooks run side by side, so everything
// that reads, changes and writes a record does it inside `withLock`.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadState, parseState, STATE_PATH } from '../formats/state.ts';
import type { SeamState } from '../formats/state.ts';
import type { Role } from '../types.ts';
import { atomicWrite, BUSY_CODES, errorCode, sleepMs } from './atomic.ts';
import { logLine } from './log.ts';
import { resolveReal } from './paths.ts';

export const LOCK_PATH = '.seam/.lock';

/** How long to wait for the lock, and how old a lock must be before it counts as left by a crash. */
export interface LockLimits {
  waitMs: number;
  staleMs: number;
}
export const LOCK_LIMITS: LockLimits = { waitMs: 5000, staleMs: 30_000 };

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

/** The text of the lock file if it exists and is at least `staleMs` old; otherwise null (absent, fresh, or busy). */
function staleOwner(file: string, staleMs: number): string | null {
  try {
    const text = readFileSync(file, 'utf8');
    return Date.now() - statSync(file).mtimeMs >= staleMs ? text : null;
  } catch (err) {
    if (errorCode(err) === 'ENOENT' || BUSY_CODES.has(errorCode(err))) return null; // already gone, or busy: nothing to clear right now
    throw err;
  }
}

/**
 * If the lock is at least `staleMs` old (its owner crashed), remove it and return true. Only one
 * process at a time may do that: it first takes `.lock.break`, then looks again, and only removes
 * the same old lock it saw before. While the old lock exists nobody can create a new one, so a live
 * lock is never taken away by a slow second look. A `.lock.break` left by a crash goes stale too.
 */
function clearIfStale(file: string, staleMs: number): boolean {
  const seen = staleOwner(file, staleMs);
  if (seen === null) return false;
  const guard = `${file}.break`;
  if (tryCreate(guard, String(process.pid)) !== '') {
    if (staleOwner(guard, staleMs) !== null) rmSync(guard, { force: true }); // its owner crashed
    return false; // someone else is clearing the lock: wait and try again
  }
  try {
    if (staleOwner(file, staleMs) !== seen) return false; // changed while we took the guard
    rmSync(file, { force: true, maxRetries: 5, retryDelay: 20 });
    return true;
  } finally {
    rmSync(guard, { force: true, maxRetries: 5, retryDelay: 20 });
  }
}

/** Wait for the lock and take it. Returns the token that marks it as ours. */
function acquire(file: string, limits: LockLimits): string {
  const token = `${process.pid} ${new Date().toISOString()} ${randomBytes(6).toString('hex')}`;
  const deadline = Date.now() + limits.waitMs;
  for (;;) {
    const why = tryCreate(file, token);
    if (why === '') return token;
    if (clearIfStale(file, limits.staleMs)) continue; // a dead lock is gone: try at once
    if (Date.now() >= deadline) {
      const detail = why === 'EEXIST' ? '' : ` (the file system kept answering ${why})`;
      throw new Error(
        `Another seam hook or command has held ${file} for ${limits.waitMs / 1000} s, so this one gave up${detail}. ` +
        `If none is running, the lock clears by itself once it is ${limits.staleMs / 1000} s old, or delete that file.`,
      );
    }
    sleepMs(5 + Math.floor(Math.random() * 15)); // a different pause each time, so waiting processes do not move in step
  }
}

/** Let go of the lock, unless it is no longer ours (ours ran so long that it was cleared as stale). */
function release(file: string, token: string): void {
  try {
    if (readFileSync(file, 'utf8') !== token) return;
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return;
    throw err;
  }
  rmSync(file, { force: true, maxRetries: 5, retryDelay: 20 });
}

/**
 * Run `fn` while holding the exclusive lock `.seam/.lock`, and let go of it afterwards, also when
 * `fn` throws. Waits up to 5 s for another holder; a lock older than 30 s is treated as dead. The
 * lock is not re-entrant: do not call `withLock` from inside `fn`. Throws if `.seam/` is missing.
 */
export function withLock<T>(root: string, fn: () => T, limits: LockLimits = LOCK_LIMITS): T {
  const file = join(root, LOCK_PATH);
  const token = acquire(file, limits);
  try {
    return fn();
  } finally {
    release(file, token);
  }
}

/** A short code for a project folder, the same for every spelling of it. Names its folder in the data folder. */
export function rootKey(root: string): string {
  return createHash('sha256').update(resolveReal(root, '.')).digest('hex').slice(0, 16);
}

/** Read `.seam/state.json`. Throws, in plain words, if it is missing, unreadable or does not fit the format. */
export function readState(root: string): SeamState {
  const state = loadState(root);
  if (state === null) throw new Error(`${STATE_PATH} is missing, so this project's state cannot be read.`);
  return state;
}

/**
 * Write `.seam/state.json` in one step and put the same text in `<dataDir>/mirror/<root key>/state.json`.
 * The mirror goes first, so an interruption between the two leaves the newer state in the mirror, where
 * it can be restored from. Refuses state that does not fit the format. It does not lock: to change
 * state, read it and write it inside one `withLock`.
 */
export function writeState(root: string, dataDir: string, s: SeamState): void {
  const text = `${JSON.stringify(parseState(s, 'The state to write'), null, 2)}\n`;
  const mirror = join(dataDir, 'mirror', rootKey(root), 'state.json');
  mkdirSync(dirname(mirror), { recursive: true });
  atomicWrite(mirror, text);
  atomicWrite(join(root, STATE_PATH), text);
}

/** Note a block: add `Blocked: <who> <what>` to the log and one to `state.blocks`, all under the lock. */
export function recordBlock(root: string, dataDir: string, who: Role, what: string): void {
  withLock(root, () => {
    const state = readState(root);
    writeState(root, dataDir, { ...state, blocks: state.blocks + 1 });
    logLine(root, `Blocked: ${who} ${what}`);
  });
}
