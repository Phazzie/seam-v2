// What the owner changed by hand: the protected files (and new code files) that differ from the guard's record, and taking
// them in. Without this the guard's next check puts the owner's work back and halts the run, blaming the main AI (R77). The
// `edit` approval and the Seam Approve window's "accept my own edits" both use it. The guard's own records under `.seam/` are
// never the owner's to edit by hand (`seam repair` puts them back), so they are left out. With no record at all (the data folder was
// lost) there is nothing to compare with but the lock, and accepting takes a fresh record of every protected file (R79).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLock, LOCK_PATH } from '../formats/lock.ts';
import { snapshotProtectedLocked } from '../guard/tamper.ts';
import { absOf, loadRecord } from '../guard/tamperrecord.ts';
import { fullScan, look } from '../guard/tamperscan.ts';
import { atomicWrite } from '../lib/atomic.ts';
import { hashFile } from '../lib/text.ts';
import type { Ctx } from '../types.ts';
import { acceptLocked } from './accept.ts';
import { relocked } from './relock.ts';

export interface Change { key: string; what: 'changed' | 'deleted' | 'new' }

export const CHANGE_WORDS: Record<Change['what'], string> = { changed: 'changed', deleted: 'deleted', new: 'new' };

/** What the window says when there is no record, and what approving then does. */
export const NO_RECORD_YET = 'The guard has no record yet; this takes a fresh record of every protected file as it is now';

/** The files, one to a line, for the owner to read: `  - tests/a.test.ts (changed)`. */
export const listChanges = (changes: Change[]): string => changes.map((c) => `  - ${c.key} (${CHANGE_WORDS[c.what]})`).join('\n');

const isSeamRecord = (key: string): boolean => key.split('/')[0].toLowerCase() === '.seam';

/** Is there no record of the protected files (the data folder was lost, or nothing ever took one)? */
export const hasNoRecord = (ctx: Ctx): boolean => loadRecord(ctx) === null;

/** With no record, the locked files that no longer are what the lock says: the only thing there is to compare with. Throws if a locked code file no longer parses. */
function lockDrift(ctx: Ctx): Change[] {
  const lock = loadLock(ctx.root);
  return Object.keys(lock?.files ?? {}).flatMap((key): Change[] => {
    if (isSeamRecord(key)) return [];
    const abs = absOf(ctx, key);
    if (look(abs) === null) return [{ key, what: 'deleted' }];
    const next = relocked(lock, key, abs);
    return next !== null && JSON.stringify(next.files[key]) !== JSON.stringify(lock?.files[key]) ? [{ key, what: 'changed' }] : [];
  });
}

/** The protected files that differ from the guard's record, and the new code files nobody planned; with no record, the locked files that differ from the lock. */
export function changesIn(ctx: Ctx): Change[] {
  const rec = loadRecord(ctx);
  if (rec === null) return lockDrift(ctx);
  return fullScan(ctx, rec)
    .filter((found) => found.kind !== 'newOther' && !isSeamRecord(found.key))
    .map((found): Change => ({ key: found.key, what: found.kind === 'file' ? (look(absOf(ctx, found.key)) === null ? 'deleted' : 'changed') : 'new' }));
}

/** What `changes` would be accepted as: a hash for each file there, `deleted` for each that is gone. Keys in order, so two sets that say the same compare as equal. */
export function editFingerprints(ctx: Ctx, changes: Change[] = changesIn(ctx)): Record<string, string> {
  const entries = changes.map((c): [string, string] => [c.key, c.what === 'deleted' ? 'deleted' : hashFile(readFileSync(absOf(ctx, c.key)))]);
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Take `changes` into the guard's record, and into the lock for each file the lock has an entry for (a locked code file is
 * fingerprinted by named item again, anything else whole, a deleted file's entry is dropped). The caller holds the project lock.
 * Throws, before anything is written, if a locked code file no longer parses. With no record at all the owner's acceptance takes a
 * fresh one of every protected file as it is now, after the lock is refreshed, so the record holds the new lock.
 */
export function acceptEditsLocked(ctx: Ctx, changes: Change[]): string[] {
  const fresh = hasNoRecord(ctx);
  let lock = loadLock(ctx.root);
  let touched = false;
  for (const { key } of changes) {
    const next = relocked(lock, key, absOf(ctx, key));
    if (next !== null) {
      lock = next;
      touched = true;
    }
  }
  if (touched && lock !== null) {
    atomicWrite(join(ctx.root, LOCK_PATH), `${JSON.stringify(lock, null, 2)}\n`);
    if (!fresh) acceptLocked(ctx, LOCK_PATH, true);
  }
  if (fresh) snapshotProtectedLocked(ctx);
  else for (const { key } of changes) acceptLocked(ctx, key, true);
  return changes.map((c) => c.key);
}
