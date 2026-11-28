// What the owner changed by hand: the protected files (and new code files) that differ from the guard's record, and taking
// them in. Without this the guard's next check puts the owner's work back and halts the run, blaming the main AI (R77). The
// `edit` approval and the Seam Approve window's "accept my own edits" both use it. The guard's own records under `.seam/` are
// never the owner's to edit by hand (`seam repair` puts them back), so they are left out.
import { readFileSync } from 'node:fs';
import { loadLock, LOCK_PATH } from '../formats/lock.ts';
import { snapshotProtectedLocked } from '../guard/tamper.ts';
import { absOf, loadRecord } from '../guard/tamperrecord.ts';
import { fullScan, look } from '../guard/tamperscan.ts';
import { atomicWrite } from '../lib/atomic.ts';
import { hashFile } from '../lib/text.ts';
import type { Ctx } from '../types.ts';
import { acceptLocked } from './accept.ts';
import { relocked } from './relock.ts';
import { join } from 'node:path';

export interface Change { key: string; what: 'changed' | 'deleted' | 'new' }

export const CHANGE_WORDS: Record<Change['what'], string> = { changed: 'changed', deleted: 'deleted', new: 'new' };

/** The files, one to a line, for the owner to read: `  - tests/a.test.ts (changed)`. */
export const listChanges = (changes: Change[]): string => changes.map((c) => `  - ${c.key} (${CHANGE_WORDS[c.what]})`).join('\n');

const isSeamRecord = (key: string): boolean => key.split('/')[0].toLowerCase() === '.seam';

/** The protected files that differ from the guard's record, and the new code files nobody planned. None if there is no record yet. */
export function changesIn(ctx: Ctx): Change[] {
  const rec = loadRecord(ctx);
  if (rec === null) return [];
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
 * Throws, before anything is written, if a locked code file no longer parses. With no record at all the owner's acceptance starts one.
 */
export function acceptEditsLocked(ctx: Ctx, changes: Change[]): string[] {
  if (loadRecord(ctx) === null) {
    snapshotProtectedLocked(ctx);
    return [];
  }
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
    acceptLocked(ctx, LOCK_PATH, true);
  }
  for (const { key } of changes) acceptLocked(ctx, key, true);
  return changes.map((c) => c.key);
}
