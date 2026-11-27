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

/** One path part as Windows reads it: no `:stream` suffix and no trailing dots or spaces. */
export function tidyPart(part: string): string {
  return (WIN ? part.split(':')[0] : part).replace(/[. ]+$/, '');
}

/** A host name or address in one comparable spelling (IPv6 literals included). */
function canonicalHost(host: string): string {
  let name = host.toLowerCase().replace(/\.$/, '');
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
 * Windows spellings of an ordinary path, made ordinary: drop the `\\?\` and `\\.\` prefixes in front
 * of a drive or UNC path, and turn the admin-share alias of this machine's own drive
 * (`\\localhost\C$\x`, `\\<host name>\c$\x`, `\\127.0.0.1\C$\x`) into `C:\x`. Any other device path
 * is refused. Any other UNC path is left as it is (it is somewhere else).
 */
function plainPath(p: string): string {
  if (!WIN) return p;
  let path = p;
  if (/^[\\/]{2}[?.][\\/]/.test(p)) {
    const body = p.slice(4);
    if (/^[a-z]:([\\/]|$)/i.test(body)) path = body;
    else if (/^unc[\\/]/i.test(body)) path = `\\\\${body.slice(4)}`;
    else throw new Error(`The Windows device path ${p} cannot be checked, so it is refused.`);
  }
  const share = /^[\\/]{2}([^\\/]+)[\\/]([a-z])\$(?:[\\/](.*))?$/is.exec(path);
  return share !== null && isLocalHost(share[1]) ? `${share[2]}:\\${share[3] ?? ''}` : path;
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
 * A UNC path on any share but `home` is returned as written without touching the network: asking
 * an unreachable host takes 20 seconds, and asking a hostile one hands it the user's credentials.
 */
function realOrNearest(abs: string, home: string, hops = 0): string {
  const share = shareOf(abs);
  if (share !== '' && share !== home) return abs;
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
      return resolve(realOrNearest(tidyAbsolute(plainPath(link)), home, hops + 1), ...tail);
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
 * appended. Throws a plain error for a path it cannot make sense of, which the guard turns into a
 * refusal.
 */
export function resolveReal(root: string, p: string): string {
  const base = tidyAbsolute(resolve(plainPath(root)));
  return spell(realOrNearest(tidyAbsolute(resolve(base, plainPath(p))), shareOf(base)));
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
