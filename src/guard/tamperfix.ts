// Undoing a change: put a file back from its kept copy, or move a file that has no place aside, out of the
// project and into `<dataDir>/quarantine/<time>/<path>`, where the owner can still look at it. A new file
// is moved without being opened, so a huge or binary one cannot hang or crash the check (Review Focus 5).
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { atomicWrite, errorCode, retryBusy } from '../lib/atomic.ts';
import { logLine } from '../lib/log.ts';
import type { Ctx } from '../types.ts';
import { BIG_FILE, blobOf } from './tamperrecord.ts';
import type { Entry, Home } from './tamperrecord.ts';

/**
 * Put a file back as it was recorded. Returns the file's new size and time (for the record), or the plain
 * reason it could not be put back (no copy was kept of a very large file, or the file system said no). A folder
 * where the file was is moved to quarantine first, not deleted: the owner may want to see what it held (R78).
 */
export function putBack(ctx: Home, abs: string, entry: Entry): Entry | string {
  const bytes = blobOf(ctx, entry.hash);
  if (bytes === null) return 'no copy of it was kept, because it is very large';
  try {
    mkdirSync(dirname(abs), { recursive: true });
    if (statSyncOrNull(abs)?.isDirectory()) {
      const key = relative(ctx.root, abs).replace(/\\/g, '/');
      const moved = moveAside({ dataDir: ctx.dataDir, now: new Date() }, key, abs);
      if (typeof moved === 'string') return `a folder is where the file was, and it could not be moved aside (${moved})`;
      logLine(ctx.root, `Moved ${key} aside (a folder where the file was recorded) to ${moved.to}`);
    }
    atomicWrite(abs, bytes);
    const { size, mtimeMs } = statSync(abs);
    return { hash: entry.hash, size, mtimeMs };
  } catch (err) {
    return (err as Error).message;
  }
}

function statSyncOrNull(abs: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(abs);
  } catch (err) {
    if (errorCode(err) === 'ENOENT' || errorCode(err) === 'ENOTDIR') return null;
    throw err;
  }
}

/** The time a quarantine folder is named for: `2026-11-28T10-15-30-123Z`. */
const stamp = (when: Date): string => when.toISOString().replace(/[:.]/g, '-');

/** `to`, or `to.2`, `to.3`... if something is there already (a file moved aside a moment ago from inside a folder that is now moved too). */
function free(to: string): string {
  let name = to;
  for (let n = 2; existsSync(name); n += 1) name = `${to}.${n}`;
  return name;
}

/**
 * Move a file or a folder out of the project into the quarantine folder (a copy and a delete when the data folder is on
 * another drive). Returns where it went, and how big it was, or the plain reason it could not be moved.
 */
export function moveAside(ctx: Pick<Ctx, 'dataDir' | 'now'>, key: string, abs: string): { to: string; big: boolean } | string {
  const wanted = join(ctx.dataDir, 'quarantine', stamp(ctx.now), ...key.split('/'));
  try {
    const { size } = statSync(abs);
    mkdirSync(dirname(wanted), { recursive: true });
    const to = free(wanted);
    try {
      retryBusy(`move ${key} aside`, () => renameSync(abs, to));
    } catch (err) {
      if (errorCode(err) !== 'EXDEV') throw err;
      cpSync(abs, to, { recursive: true });
      rmSync(abs, { recursive: true, force: true });
    }
    return { to, big: size > BIG_FILE };
  } catch (err) {
    return (err as Error).message;
  }
}
