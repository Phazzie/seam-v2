// One canonical spelling for any path a tool names, so every guard rule sees the same text for the
// same file however it was written: slashes, letter case, `..` hops, trailing dots, `::$DATA`,
// `\\?\` prefixes, `\\localhost\C$\` aliases and links. The spelling is absolute, uses forward
// slashes, and is lower-cased on Windows, where the file system does not tell `Total.ts` from `total.ts`.
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { basename, dirname, parse, resolve } from 'node:path';

const WIN = process.platform === 'win32';
/** Error codes that mean "nothing is there (yet)": the normal case for a file about to be made. */
const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EINVAL']);
const MAX_LINK_HOPS = 32;
/** A network path as Windows writes it: exactly two leading separators, then a host and a share. */
const UNC_PATH = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)(?:[\\/](.*))?$/s;

/** One path part as Windows reads it: no `:stream` suffix and no trailing dots or spaces. */
export function tidyPart(part: string): string {
  return (WIN ? part.split(':')[0] : part).replace(/[. ]+$/, '');
}

/** A host name or address in one comparable spelling (IPv6 literals included). */
function canonicalHost(host: string): string {
  let name = host.toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
  if (name.endsWith('.ipv6-literal.net')) {
    name = name.slice(0, -'.ipv6-literal.net'.length).replace(/-/g, ':').replace(/s\d+$/, '');
  }
  if (!name.includes(':')) return name;
  try {
    return new URL(`http://[${name}]`).hostname.slice(1, -1);
  } catch {
    return name; // not a valid IPv6 address: compared as plain text, which then matches nothing
  }
}

let localNames: Set<string> | undefined;
/** Is `host` this machine? (`localhost`, any 127.x address, ::1, its host name, or one of its own addresses.) */
function isLocalHost(host: string): boolean {
  const name = canonicalHost(host);
  if (name === 'localhost' || name === '::1' || /^127(?:\.\d+){3}$/.test(name)) return true;
  localNames ??= new Set([
    canonicalHost(hostname()),
    ...Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((info) => canonicalHost(info.address))),
  ]);
  return localNames.has(name);
}

/**
 * Windows spellings of an ordinary path, made ordinary. The `\\?\` and `\\.\` prefixes in front of a
 * drive or UNC path are dropped, and the admin-share alias of this machine's own drive
 * (`\\localhost\C$\x`, `\\<host name>\c$\x`, `\\127.0.0.1\C$\x`) becomes `C:\x`. Anything else that
 * starts with two or more separators must be exactly `\\host\share[\rest]`: two separators, a
 * non-empty host and share, one separator between them, also inside a `\\?\UNC\` prefix. Anything
 * else is refused, because Windows reads the odd ones (`\\?\UNC\\host\share`, `\\\host\share`) as
 * that same network path while a plain reading would put them inside the drive. A well-formed
 * network path that is not a local drive alias is returned as it is; `settle` then refuses it
 * unless it is on the root's share. Throws for what it refuses.
 */
export function plainPath(p: string): string {
  if (!WIN) return p;
  let path = p;
  if (/^[\\/]{2}[?.][\\/]/.test(p)) {
    const body = p.slice(4);
    if (/^[a-z]:([\\/]|$)/i.test(body)) return body;
    if (!/^unc(?:[\\/]|$)/i.test(body)) throw new Error(`The Windows device path ${p} cannot be checked, so it is refused.`);
    path = `\\\\${body.slice(4)}`; // `UNC\host\share\x` becomes `\\host\share\x`; a stray separator stays and fails below
  }
  if (!/^[\\/]{2}/.test(path)) return path;
  const unc = UNC_PATH.exec(path);
  if (unc === null) {
    throw new Error(`The network path ${p} is not written as \\\\host\\share\\... and cannot be checked, so it is refused.`);
  }
  return /^[a-z]\$$/i.test(unc[2]) && isLocalHost(unc[1]) ? `${unc[2][0]}:\\${unc[3] ?? ''}` : path;
}

/** An absolute path with every part tidied (see tidyPart). Parts left empty are dropped. */
function tidyAbsolute(abs: string): string {
  const { root } = parse(abs);
  const parts = abs.slice(root.length).split(/[\\/]+/).map(tidyPart).filter((part) => part !== '');
  return resolve(root, ...parts);
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

/** The link's target if `p` is a link that points at nothing, else null. */
function danglingLink(p: string): string | null {
  try {
    return lstatSync(p).isSymbolicLink() ? resolve(dirname(p), readlinkSync(p)) : null;
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
  const base = tidyAbsolute(resolve(plainPath(root)));
  let rootShare: string | undefined;
  const allowed = (share: string): boolean => {
    if (share === shareOf(base)) return true;
    rootShare ??= shareOf(realOrNearest(base, () => true)); // the share the root really sits on
    return share === rootShare;
  };
  return spell(realOrNearest(tidyAbsolute(resolve(base, plainPath(p))), allowed));
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
