// Looking for what changed, without changing anything. The quick pass compares the size and the modified
// time of each recorded file (15.17: enough after a file tool); the full pass hashes them all and also
// walks the project for new files (after a command or any tool the guard does not know). Both give the
// same thing: a list of paths to look at again, under the lock, where the answer is settled.
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { errorCode } from '../lib/atomic.ts';
import { classify, placesOf, protectedClass } from '../lib/paths.ts';
import type { Ctx } from '../types.ts';
import { absOf, fold, hashOf } from './tamperrecord.ts';
import type { Entry, TamperRecord } from './tamperrecord.ts';
import { walkRepo } from './tamperwalk.ts';

/**
 * `file`: a recorded file that looks changed or gone. `newProtected`: a file in a protected place that was not
 * recorded. `newCode`: a code file nobody knew that git does not ignore. `newOther`: a code file nobody knew that
 * is harmless (git ignores it), to be added to the list so it is not asked about again.
 */
export interface Finding { key: string; kind: 'file' | 'newProtected' | 'newCode' | 'newOther' }

/** The size and time of a file, or null if it is not there. */
export function look(abs: string): { size: number; mtimeMs: number } | null {
  try {
    const { size, mtimeMs } = lstatSync(abs);
    return { size, mtimeMs };
  } catch (err) {
    if (errorCode(err) === 'ENOENT' || errorCode(err) === 'ENOTDIR') return null;
    throw err;
  }
}

/** The quick pass: every recorded file whose size or modified time is not what was recorded, or that is gone. */
export function quickScan(ctx: Ctx, rec: TamperRecord): Finding[] {
  return Object.entries(rec.files).flatMap(([key, entry]) => {
    const now = look(absOf(ctx, key));
    return now === null || now.size !== entry.size || now.mtimeMs !== entry.mtimeMs ? [{ key, kind: 'file' as const }] : [];
  });
}

/** Is the file at `abs` not what `entry` says? Looks at the size first, and reads the file only when that is the same. */
function differs(abs: string, entry: Entry): boolean {
  const now = look(abs);
  if (now === null || now.size !== entry.size) return true;
  return hashOf(abs) !== entry.hash;
}

/** The full pass: every recorded file hashed, and the project walked for files that were not recorded. */
export function fullScan(ctx: Ctx, rec: TamperRecord): Finding[] {
  const found: Finding[] = [];
  const seen = new Set<string>();
  const known = new Set(rec.code);
  walkRepo(ctx, ({ key, abs, cls }) => {
    const entry = rec.files[key];
    if (entry !== undefined) {
      seen.add(key);
      if (differs(abs, entry)) found.push({ key, kind: 'file' });
    } else if (cls !== null) {
      found.push({ key, kind: 'newProtected' });
    } else if (!known.has(key)) {
      found.push({ key, kind: classify(ctx, abs) === 'app-code' ? 'newCode' : 'newOther' });
    }
  });
  for (const key of Object.keys(rec.files)) if (!seen.has(key)) found.push({ key, kind: 'file' });
  return found;
}

/** A path from the repo root with the case the file system has for each part (the walk's spelling), or null if nothing is there. */
function realKey(ctx: Ctx, folded: string): string | null {
  const parts: string[] = [];
  let dir = ctx.root;
  for (const part of folded.split('/')) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (err) {
      if (errorCode(err) === 'ENOENT' || errorCode(err) === 'ENOTDIR') return null;
      throw err;
    }
    const name = names.find((n) => fold(n) === part);
    if (name === undefined) return null;
    parts.push(name);
    dir = join(dir, name);
  }
  return parts.join('/');
}

/**
 * New files that a write the guard allowed has made in a protected place: the record does not hold them yet, and
 * the quick pass does not look for new files. `allowed` are the paths the write was let through for (folded).
 */
export function newByWrite(ctx: Ctx, rec: TamperRecord, allowed: readonly string[]): Finding[] {
  const held = new Set(Object.keys(rec.files).map(fold));
  const places = placesOf(ctx);
  return allowed.flatMap((path) => {
    const cls = held.has(path) ? null : protectedClass(ctx, places, `${places.root}/${path}`, path);
    const key = cls === null || cls === 'generated' ? null : realKey(ctx, path);
    return key === null ? [] : [{ key, kind: 'newProtected' as const }];
  });
}
