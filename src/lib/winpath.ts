// The Windows-only spellings of a path, made ordinary before the rest of the path code looks at them:
// `\\?\` prefixes, `\\localhost\C$\` aliases and network paths. Everywhere else they are plain text.
import { hostname, networkInterfaces } from 'node:os';

/** Is this Windows? Decided once: the trailing-dot and stream tidying, the lower-casing and the network paths exist only there. */
export const WIN = process.platform === 'win32';
/** A network path as Windows writes it: exactly two leading separators, then a host and a share. */
const UNC_PATH = /^[\\/]{2}([^\\/]+)[\\/]([^\\/]+)(?:[\\/](.*))?$/s;

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
