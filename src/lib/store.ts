// The state store: reading and writing `.seam/state.json` (with its copy in the data folder).
// Hooks run side by side, so anything that reads, changes and writes state does it in one
// `withLock` (see lock.ts), most simply with `updateState`.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadState, parseState, STATE_PATH } from '../formats/state.ts';
import type { SeamState } from '../formats/state.ts';
import type { Role } from '../types.ts';
import { atomicWrite, errorCode } from './atomic.ts';
import { withLock } from './lock.ts';
import { logLine } from './log.ts';
import { resolveReal } from './paths.ts';
import { requireSeamDir } from './seamdir.ts';

export { LOCK_LIMITS, LOCK_PATH, withLock } from './lock.ts';
export type { LockLimits } from './lock.ts';

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
 * it can be restored from. Refuses state that does not fit the format, and a folder with no `.seam/`
 * (no mirror is made for it). It does not lock: to change state, use `updateState`.
 */
export function writeState(root: string, dataDir: string, s: SeamState): void {
  const text = `${JSON.stringify(parseState(s, 'The state to write'), null, 2)}\n`;
  requireSeamDir(root, 'the state cannot be written');
  const mirror = join(dataDir, 'mirror', rootKey(root), 'state.json');
  mkdirSync(dirname(mirror), { recursive: true });
  atomicWrite(mirror, text);
  atomicWrite(join(root, STATE_PATH), text);
}

/** The text of a file, or null if it is not there. */
function textOrNull(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    throw err;
  }
}

/**
 * A change to the state is made from state.json as it is, and its result goes into the copy in the data folder, which is what the
 * tamper check trusts. So before the state is changed from, state.json has to be what the guard last wrote (R78): if a command had
 * changed it behind the guard (the phase set ahead, say) and a refusal were then recorded, the change would be copied into the
 * copy and kept. If the two differ the copy wins, whether state.json was changed, deleted or filled with junk, or a write was
 * interrupted after the copy (the copy goes first, so it is the newer one): state.json is put back from it and the change is made on that.
 * Under the lock. A project with no copy yet has nothing to compare with.
 */
function mendState(root: string, dataDir: string): void {
  const copy = textOrNull(join(dataDir, 'mirror', rootKey(root), 'state.json'));
  if (copy === null || textOrNull(join(root, STATE_PATH)) === copy) return;
  atomicWrite(join(root, STATE_PATH), copy);
  logLine(root, `Put back ${STATE_PATH}, which was changed behind the guard.`);
}

/**
 * `updateState` for a caller that already holds the project lock (a seam script that does several things in one hold:
 * the lock is not re-entrant, so it cannot call `updateState` from inside its own `withLock`).
 */
export function updateStateLocked(root: string, dataDir: string, change: (s: SeamState) => SeamState): SeamState {
  mendState(root, dataDir);
  const next = change(readState(root));
  writeState(root, dataDir, next);
  return next;
}

/**
 * Change the state: read it, let `change` make the new one, write it (and its mirror), all under the
 * lock, and return the new state. If `change` throws, nothing is written. `change` must be synchronous.
 */
export function updateState(root: string, dataDir: string, change: (s: SeamState) => SeamState): SeamState {
  return withLock(root, () => updateStateLocked(root, dataDir, change));
}

/** Note a block: add one to `state.blocks` (under the lock) and `Blocked: <who> <what>` to the log. */
export function recordBlock(root: string, dataDir: string, who: Role, what: string): void {
  updateState(root, dataDir, (s) => ({ ...s, blocks: s.blocks + 1 }));
  logLine(root, `Blocked: ${who} ${what}`);
}
