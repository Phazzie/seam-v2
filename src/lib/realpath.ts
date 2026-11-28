// One canonical spelling for any path a tool names, so every guard rule sees the same text for the
// same file however it was written: slashes, letter case, `..` hops, trailing dots, `::$DATA`,
// `\\?\` prefixes, `\\localhost\C$\` aliases and links. The spelling is absolute, uses forward
// slashes, and is lower-cased on Windows, where the file system does not tell `Total.ts` from `total.ts`.
// Windows tidies names and collapses `..` as text. Elsewhere a name is exactly what it says (`a.` is not
// `a`) and the file system follows each link before it applies the next `..`, so there the text is left
// for the file system to read in order.
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, parse, resolve } from 'node:path';
import { plainPath, WIN } from './winpath.ts';

/** Error codes that mean "nothing is there (yet)": the normal case for a file about to be made. */
const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EINVAL']);
const MAX_LINK_HOPS = 32;

/**
 * One path part as Windows reads it: no `:stream` suffix and no trailing dots or spaces. Only Windows does
 * that. On Linux and macOS the dots, spaces and colons are part of the name, and trimming them would look
 * up a different file than the one the tool means (a link called `a.` is not the file `a`).
 */
export function tidyPart(part: string): string {
  return WIN ? part.split(':')[0].replace(/[. ]+$/, '') : part;
}

/**
 * An absolute path with every part tidied (see tidyPart) and empty parts dropped. Windows also collapses
 * `.` and `..` here, as text. Elsewhere only `.` goes: a `..` is kept, because it means the folder above
 * what the part before it really is, which is not the folder above it as written when that part is a link.
 */
function tidyAbsolute(abs: string): string {
  const { root } = parse(abs);
  if (!WIN) return root + abs.slice(root.length).split('/').filter((part) => part !== '' && part !== '.').join('/');
  const parts = abs.slice(root.length).split(/[\\/]+/).map(tidyPart).filter((part) => part !== '');
  return resolve(root, ...parts);
}

/**
 * `p` read from the folder `base` ('' is the current folder), not yet tidied. An absolute `p` stands alone.
 * Windows collapses the `..` in it at once. Elsewhere they stay in the text, because only the file system
 * knows, reading left to right, which folder `link/..` is.
 */
function from(base: string, p: string): string {
  if (WIN) return resolve(base, p);
  return isAbsolute(p) ? p : `${base === '' ? process.cwd() : base}/${p}`;
}

/** The `\\server\share\` start of a UNC path in lower case, or '' for any other path. */
function shareOf(abs: string): string {
  const { root } = parse(abs);
  return WIN && /^[\\/]{2}/.test(root) ? root.toLowerCase() : '';
}

/**
 * A path as the file system, a link or a caller gave it, made ordinary (see plainPath) and checked:
 * a network share is refused unless `allowed` says it is the root's own. It may be this machine under
 * a name we do not know (`\\localhost\Users\...` is `C:\Users\...`), asking an unreachable host takes
 * 20 seconds, and asking a hostile one hands it the user's credentials. Exported to be tested alone.
 */
export function settle(path: string, allowed: (share: string) => boolean): string {
  const plain = tidyAbsolute(plainPath(path));
  const share = shareOf(plain);
  if (share !== '' && !allowed(share)) {
    throw new Error(`The network path ${plain} cannot be checked, so it is refused. Use the drive path (C:\\...) instead.`);
  }
  return plain;
}

/**
 * The link's target if `p` is a link that points at nothing, else null. A relative target is read from the
 * folder the link really sits in; elsewhere than Windows that folder is looked up (`p` may reach it through a
 * `..` that is still unresolved), and the target's own `..` stay for the file system to read in order.
 */
function danglingLink(p: string): string | null {
  try {
    if (!lstatSync(p).isSymbolicLink()) return null;
    return from(WIN ? dirname(p) : realpathSync.native(dirname(p)), readlinkSync(p));
  } catch (err) {
    if (MISSING.has((err as NodeJS.ErrnoException).code ?? '')) return null; // nothing there at all
    throw new Error(`Could not work out where ${p} points: ${(err as Error).message}`);
  }
}

/**
 * The real location of `abs`; the part that does not exist yet is appended, tidied, as written.
 * The path is checked with `settle` before anything is looked up, and so is every real location the
 * file system answers with, so a link that leads to a network path cannot come back unchecked.
 */
function realOrNearest(abs: string, allowed: (share: string) => boolean, hops = 0): string {
  const tail: string[] = [];
  let cur = settle(abs, allowed);
  for (;;) {
    let real: string | null = null;
    try {
      real = realpathSync.native(cur);
    } catch (err) {
      if (!MISSING.has((err as NodeJS.ErrnoException).code ?? '')) {
        throw new Error(`Could not work out where ${abs} points: ${(err as Error).message}`);
      }
      // Missing is expected for a file about to be created: look one folder up.
    }
    if (real !== null) return resolve(settle(real, allowed), ...tail);
    const link = danglingLink(cur);
    if (link !== null) {
      if (hops >= MAX_LINK_HOPS) throw new Error(`Too many links to follow for ${abs}.`);
      return resolve(realOrNearest(link, allowed, hops + 1), ...tail);
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
  return spell(tidyAbsolute(resolve(plainPath(base), plainPath(p))));
}

/**
 * The canonical form of `p` (a relative `p` is taken from `root`; pass '.' to canonicalize `root`
 * itself). An existing path comes back as its real location, with links and 8.3 short names
 * followed; for one that does not exist yet the nearest existing folder is resolved and the rest is
 * appended. Throws a plain error for a path it cannot make sense of or must not look at (a device
 * path, a malformed or foreign network path), which the guard turns into a refusal. A network
 * share is accepted only when it is the root's own; a drive letter that is itself a mapped share
 * counts as the root's own.
 */
export function resolveReal(root: string, p: string): string {
  const base = tidyAbsolute(from('', plainPath(root)));
  let rootShare: string | undefined;
  const allowed = (share: string): boolean => {
    if (share === shareOf(base)) return true;
    rootShare ??= shareOf(realOrNearest(base, () => true)); // the share the root really sits on
    return share === rootShare;
  };
  return spell(realOrNearest(tidyAbsolute(from(base, plainPath(p))), allowed));
}

/**
 * `p` relative to `root`, in forward slashes, or null if `p` is outside `root`. The root itself
 * gives "". It compares text only (Windows: ignoring case and dots), so give it paths that came
 * from resolveReal, and note that on Windows the answer is lower case. It throws, like resolveReal,
 * for a device path or a malformed network path.
 */
export function rel(root: string, p: string): string | null {
  const base = lexical(root, '.');
  const target = lexical(root, p);
  if (target === base) return '';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return target.startsWith(prefix) ? target.slice(prefix.length) : null;
}
