// `seam edit <file>`: take the owner's own change to a protected file as the new truth. Without it the tamper check
// would undo the change as the AI's tampering. It runs in the approval window (a keyboard, opened from the shortcut),
// asks once, then makes the guard's record hold the file as it is now, and, if the lock has an entry for it, re-fingerprints
// that entry (a locked code file by named item, anything else whole), so the lock agrees with the file too.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { LOCK_PATH, parseLock } from '../formats/lock.ts';
import type { FileLock, Lock } from '../formats/lock.ts';
import { fold, hashOf, loadRecord } from '../guard/tamperrecord.ts';
import { atomicWrite } from '../lib/atomic.ts';
import { fingerprintSource, parseProblem, parseSource } from '../lib/codeprint.ts';
import { logLine } from '../lib/log.ts';
import { classify } from '../lib/paths.ts';
import { hashFile } from '../lib/text.ts';
import type { Ctx } from '../types.ts';
import { accept } from './accept.ts';
import { refusedOutsideWindow } from './owner.ts';
import type { OwnerIo } from './owner.ts';

const REFUSAL = 'accepting your own edits happens in the Seam Approve window on your desktop';
/** Kinds of path the guard does not protect: nothing to accept. */
const UNWATCHED = new Set(['other-in-repo', 'ignored', 'generated']);

/** The path of the file from the repo root (forward slashes, in the spelling the guard's records use), or null if it is not inside the project. */
function keyOf(ctx: Ctx, cwd: string, file: string): string | null {
  const typed = resolve(cwd, file);
  const real = existsSync(typed) ? realpathSync.native(typed) : typed; // the case the file system has, so the key matches what the walk records
  const key = relative(realpathSync.native(ctx.root), real).replace(/\\/g, '/');
  if (key === '' || key === '..' || key.startsWith('../') || isAbsolute(key)) return null;
  const known = [...Object.keys(loadRecord(ctx)?.files ?? {}), ...Object.keys(ctx.lock?.files ?? {})].find((name) => fold(name) === fold(key));
  return known ?? key;
}

/** A locked code file's entry for the text it holds now. Throws, in plain words, if the text is not code that can be read. */
function codeEntry(key: string, text: string): FileLock {
  const sf = parseSource(key, text);
  const broken = parseProblem(sf);
  if (broken !== null) throw new Error(`${key} can't be accepted: ${broken}`);
  return fingerprintSource(sf);
}

/** The lock with this file's entry made to match the file, or null if the lock has no entry for it (nothing to change). */
function relocked(lock: Lock | null, key: string, abs: string): Lock | null {
  const name = Object.keys(lock?.files ?? {}).find((n) => fold(n) === fold(key));
  if (lock === null || name === undefined) return null;
  const files: Record<string, FileLock> = { ...lock.files };
  if (!existsSync(abs)) {
    delete files[name];
  } else {
    const bytes = readFileSync(abs);
    files[name] = lock.files[name].kind === 'code' ? codeEntry(key, bytes.toString('utf8')) : { kind: 'whole', hash: hashFile(bytes) };
  }
  return parseLock({ version: 1, files }, 'The lock to write');
}

/** Does the guard already hold the file exactly as it is now? */
function held(ctx: Ctx, key: string, abs: string): boolean {
  const entry = loadRecord(ctx)?.files[key];
  return existsSync(abs) ? entry !== undefined && hashOf(abs) === entry.hash : entry === undefined;
}

/** The project, or null (with the reason said) if its plan, lock or state cannot be read: a plan the owner broke by hand is refused here, not accepted. */
function readable(load: () => Ctx, io: OwnerIo): Ctx | null {
  try {
    return load();
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    io.say(`${err.message} Nothing was accepted: seam edit needs plan.json, lock.json and state.json to be readable. Fix the file, or run seam repair to put back the guard's saved copy.`);
    return null;
  }
}

/** Run `seam edit`: returns the exit code. `load` reads the project and is not called until the window has been checked. */
export async function editFile(io: OwnerIo, load: () => Ctx, file: string | undefined, cwd: string): Promise<number> {
  if (refusedOutsideWindow(io, REFUSAL)) return 1;
  if (file === undefined || file === '') {
    io.say('Which file? Use: seam edit <file>');
    return 1;
  }
  const ctx = readable(load, io);
  if (ctx === null) return 1;
  const key = keyOf(ctx, cwd, file);
  if (key === null) {
    io.say(`${file} is not inside this project, so there is nothing to accept.`);
    return 1;
  }
  const abs = join(ctx.root, ...key.split('/'));
  if (key.split('/')[0].toLowerCase() === '.seam') {
    io.say(`${key} is one of the guard's own records, which are not edited by hand. If plan.json, lock.json or state.json cannot be read, run seam repair in your own terminal.`);
    return 1;
  }
  const known = loadRecord(ctx)?.files[key] !== undefined || ctx.lock?.files[key] !== undefined;
  if (!existsSync(abs) && !known) {
    io.say(`${key} is not there, and the guard has nothing of it, so there is nothing to accept.`);
    return 1;
  }
  if (!known && UNWATCHED.has(classify(ctx, abs))) {
    io.say(`${key} is a file the guard does not watch, so there is nothing to accept: change it however you like.`);
    return 0;
  }
  const lock = relocked(ctx.lock, key, abs);
  if (held(ctx, key, abs) && (lock === null || JSON.stringify(lock) === JSON.stringify(ctx.lock))) {
    io.say(`The guard already has ${key} exactly as it is now, so there is nothing to accept.`);
    return 0;
  }
  io.say(`${key} ${existsSync(abs) ? 'is different from what the guard has' : 'has been deleted'}. Accepting it makes the guard treat ${existsSync(abs) ? 'this version' : 'its absence'} as the approved one${lock === null ? '' : ' and updates its entry in the lock'}.`);
  const answer = (await io.ask(`Accept ${key} as it is now? Type yes to accept: `)).trim().toLowerCase();
  if (answer !== 'yes' && answer !== 'y') {
    io.say('Nothing was accepted.');
    return 1;
  }
  if (lock !== null) {
    atomicWrite(join(ctx.root, LOCK_PATH), `${JSON.stringify(lock, null, 2)}\n`);
    accept(ctx, LOCK_PATH, true);
  }
  accept(ctx, key, true);
  logLine(ctx.root, `Owner accepted a hand edit to ${key}`);
  io.say(`Accepted ${key}.`);
  return 0;
}
