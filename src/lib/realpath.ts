// One canonical spelling for any path a tool names, so every guard rule sees the same text for the
// same file however it was written: slashes, letter case, `..` hops, trailing dots, `::$DATA`,
// `\\?\` prefixes and links. The spelling is absolute, uses forward slashes, and is lower-cased
// on Windows, where the file system does not tell `Total.ts` from `total.ts`.
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, parse, resolve } from 'node:path';

const WIN = process.platform === 'win32';
/** Error codes that mean "nothing is there (yet)": the normal case for a file about to be made. */
const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EINVAL']);
const MAX_LINK_HOPS = 32;

/** One path part as Windows reads it: no `:stream` suffix and no trailing dots or spaces. */
export function tidyPart(part: string): string {
  return (WIN ? part.split(':')[0] : part).replace(/[. ]+$/, '');
}

/** Drop Windows' `\\?\` and `\\.\` prefixes in front of a drive or UNC path; refuse any other device path. */
function devicePath(p: string): string {
  if (!WIN || !/^[\\/]{2}[?.][\\/]/.test(p)) return p;
  const body = p.slice(4);
  if (/^[a-z]:([\\/]|$)/i.test(body)) return body;
  if (/^unc[\\/]/i.test(body)) return `\\\\${body.slice(4)}`;
  throw new Error(`The Windows device path ${p} cannot be checked, so it is refused.`);
}

/** An absolute path with every part tidied (see tidyPart). Parts left empty are dropped. */
function tidyAbsolute(abs: string): string {
  const { root } = parse(abs);
  const parts = abs.slice(root.length).split(/[\\/]+/).map(tidyPart).filter((part) => part !== '');
  return resolve(root, ...parts);
}

/** The link's target if `p` is a link that points at nothing, else null. */
function danglingLink(p: string): string | null {
  try {
    return lstatSync(p).isSymbolicLink() ? resolve(dirname(p), readlinkSync(p)) : null;
  } catch (err) {
    if (MISSING.has((err as NodeJS.ErrnoException).code ?? '')) return null; // nothing there at all
    throw new Error(`Could not work out where ${p} points: ${(err as Error).message}`);
  }
}

/** The real location of `abs`; the part that does not exist yet is appended, tidied, as written. */
function realOrNearest(abs: string, hops = 0): string {
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return resolve(realpathSync.native(cur), ...tail);
    } catch (err) {
      if (!MISSING.has((err as NodeJS.ErrnoException).code ?? '')) {
        throw new Error(`Could not work out where ${abs} points: ${(err as Error).message}`);
      }
      // Missing is expected for a file about to be created: look one folder up.
    }
    const link = danglingLink(cur);
    if (link !== null) {
      if (hops >= MAX_LINK_HOPS) throw new Error(`Too many links to follow for ${abs}.`);
      return resolve(realOrNearest(tidyAbsolute(devicePath(link)), hops + 1), ...tail);
    }
    const parent = dirname(cur);
    if (parent === cur) return resolve(cur, ...tail); // not even the drive exists
    tail.unshift(basename(cur));
    cur = parent;
  }
}

/** Forward slashes, and lower case on Windows. */
function spell(p: string): string {
  return WIN ? p.replace(/\\/g, '/').toLowerCase() : p;
}

/** The text-only spelling of a path (no file system access), used to compare two paths. */
function lexical(base: string, p: string): string {
  return spell(tidyAbsolute(resolve(devicePath(base), devicePath(p))));
}

/**
 * The canonical form of `p` (relative paths are taken from `root`). An existing path comes back
 * as its real location, with links and 8.3 short names followed; for one that does not exist yet
 * the nearest existing folder is resolved and the rest is appended. Throws a plain error for a
 * path it cannot make sense of, which the guard turns into a refusal.
 */
export function resolveReal(root: string, p: string): string {
  return spell(realOrNearest(tidyAbsolute(resolve(devicePath(root), devicePath(p)))));
}

/**
 * `p` relative to `root`, in forward slashes, or null if `p` is outside `root`. The root itself
 * gives "". It compares text only (Windows: ignoring case and dots), so give it paths that came
 * from resolveReal, and note that on Windows the answer is lower case.
 */
export function rel(root: string, p: string): string | null {
  const base = lexical(root, '.');
  const target = lexical(root, p);
  if (target === base) return '';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return target.startsWith(prefix) ? target.slice(prefix.length) : null;
}
