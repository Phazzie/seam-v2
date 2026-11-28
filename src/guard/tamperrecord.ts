// The guard's record of the protected files, kept in the plugin's data folder where the AI cannot reach it:
// `<dataDir>/mirror/<root key>/protected.json` holds `{ path: { hash, size, mtimeMs } }` for each file, and
// `blobs/<hash>` holds that file's content so it can be put back. The record also lists the code files that
// were there (a new one is a new file) and counts the changes in a row that could not be tied to a call.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parseWith } from '../formats/read.ts';
import { atomicWrite, errorCode } from '../lib/atomic.ts';
import { WIN } from '../lib/winpath.ts';
import { rootKey } from '../lib/store.ts';
import type { Ctx } from '../types.ts';

const EntrySchema = z.strictObject({ hash: z.string(), size: z.number(), mtimeMs: z.number() });
const RecordSchema = z.strictObject({
  version: z.literal(1),
  files: z.record(z.string(), EntrySchema),
  code: z.array(z.string()),
  unattributed: z.number().int().nonnegative(),
});
export type Entry = z.infer<typeof EntrySchema>;
export type TamperRecord = z.infer<typeof RecordSchema>;

/** A file bigger than this is recorded by its hash only: a copy of it would fill the data folder. */
export const KEEP_LIMIT = 16 * 1024 * 1024;
/** A new file bigger than this is moved aside without being read at all (Review Focus 5). */
export const BIG_FILE = 2 * 1024 * 1024;

/** A path as it is compared: lower case on Windows, where the file system does not tell `Plan` from `plan`. */
export const fold = (path: string): string => (WIN ? path.toLowerCase() : path);

/** The project's own folder in the data folder (the one that also holds the copy of state.json). */
export const recordFolder = (ctx: Ctx): string => join(ctx.dataDir, 'mirror', rootKey(ctx.root));

/** Where a path from the repo root (forward slashes) is on disk. */
export const absOf = (ctx: Ctx, key: string): string => join(ctx.root, ...key.split('/'));

/** The saved record, or null if there is none yet. Throws a plain error if it is there and does not fit. */
export function loadRecord(ctx: Ctx): TamperRecord | null {
  const file = join(recordFolder(ctx), 'protected.json');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    throw new Error(`The guard's record of the protected files (${file}) is unreadable: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`The guard's record of the protected files (${file}) is not valid JSON (${(err as Error).message}).`);
  }
  return parseWith(RecordSchema, raw, "The guard's record of the protected files");
}

/** Save the record in one step. */
export function saveRecord(ctx: Ctx, rec: TamperRecord): void {
  const folder = recordFolder(ctx);
  mkdirSync(folder, { recursive: true });
  atomicWrite(join(folder, 'protected.json'), `${JSON.stringify(rec)}\n`);
}

/** A record with nothing in it. */
export const emptyRecord = (): TamperRecord => ({ version: 1, files: {}, code: [], unattributed: 0 });

/** The sha256 of a file's bytes, in hex. */
export const hashOf = (abs: string): string => createHash('sha256').update(readFileSync(abs)).digest('hex');

/**
 * Read a file for the record: its hash, size and time, and keep a copy named by the hash. The time is taken
 * before the content is read, so a file changed in between looks changed later, never unchanged.
 */
export function measure(ctx: Ctx, abs: string): Entry {
  const { size, mtimeMs } = statSync(abs);
  const bytes = readFileSync(abs);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const blob = join(recordFolder(ctx), 'blobs', hash);
  if (size <= KEEP_LIMIT && !existsSync(blob)) {
    mkdirSync(join(recordFolder(ctx), 'blobs'), { recursive: true });
    atomicWrite(blob, bytes);
  }
  return { hash, size, mtimeMs };
}

/** The kept copy of a file's content, or null if none was kept (it was too big). */
export function blobOf(ctx: Ctx, hash: string): Buffer | null {
  try {
    return readFileSync(join(recordFolder(ctx), 'blobs', hash));
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    throw err;
  }
}
