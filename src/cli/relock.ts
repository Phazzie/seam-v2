// Making the lock agree with a file the owner changed by hand: `seam edit` does it for one file, the Seam Approve window (and the
// `edit` approval) for every protected file that differs from the guard's record. A locked code file is fingerprinted by named
// item again, anything else whole, and the entry of a file that is gone is dropped.
import { existsSync, readFileSync } from 'node:fs';
import { parseLock } from '../formats/lock.ts';
import type { FileLock, Lock } from '../formats/lock.ts';
import { fold } from '../guard/tamperrecord.ts';
import { fingerprintSource, parseProblem, parseSource } from '../lib/codeprint.ts';
import { hashFile } from '../lib/text.ts';

/** A locked code file's entry for the text it holds now. Throws, in plain words, if the text is not code that can be read. */
function codeEntry(key: string, text: string): FileLock {
  const sf = parseSource(key, text);
  const broken = parseProblem(sf);
  if (broken !== null) throw new Error(`${key} can't be accepted: ${broken}`);
  return fingerprintSource(sf);
}

/** The lock with this file's entry made to match the file at `abs`, or null if the lock has no entry for it (nothing to change). */
export function relocked(lock: Lock | null, key: string, abs: string): Lock | null {
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
