// Checks the hook makes on a path before anything else looks at it.
import { plainPath } from './realpath.ts';

/** `\\?\` or `//?/` (and the `\\.\` device form): Windows turns its name tidying off after these. */
const EXTENDED = /^[\\/]{2}[?.][\\/]/;
const ENDS_ODD = /[. ]$/;

/**
 * After a `\\?\` prefix Windows does not drop a trailing dot or space from a name, so `src\a.ts.` is
 * a different file from `src\a.ts`, while the guard's path code (which has to tidy names the way
 * ordinary Windows paths are tidied) sees them as the same. A path like that is refused. Returns the
 * reason (plain words), or null when the path is fine.
 */
export function extendedPathProblem(path: string): string | null {
  if (!EXTENDED.test(path)) return null;
  const odd = path.slice(4).split(/[\\/]+/).find((part) => ENDS_ODD.test(part));
  if (odd === undefined) return null;
  return `The path ${path} has a part ("${odd}") that ends in a dot or a space. Windows keeps that exact name after a \\\\?\\ prefix, which the guard cannot check, so the path is refused. Use the plain drive path (C:\\...) instead.`;
}

/** What the path code says when it refuses a path on purpose (a network or device path it cannot check). */
const REFUSED = /cannot be checked, so it is refused/;

/** Is this error the path code deliberately refusing a path, as opposed to something breaking? */
export function isPathRefusal(err: unknown): err is Error {
  return err instanceof Error && REFUSED.test(err.message);
}

/** Two separators at the start: a network path (`\\host\share`), or the `\\?\` and `\\.\` forms. */
const NETWORK_TEXT = /^[\\/]{2}/;

/**
 * Is this a network path (`\\host\share\...`) that stays one once Windows spellings are made ordinary
 * (plainPath)? This machine's own admin share (`//localhost/c$/x`) does not: it is `c:\x`, a local folder.
 * A malformed network path stays one (plainPath refuses it). The `\\?\` and `\\.\` forms are not decided
 * here (false): they can be a local path in another spelling. Text only; it never asks the network.
 */
export function staysOnNetwork(path: string): boolean {
  if (!NETWORK_TEXT.test(path) || EXTENDED.test(path)) return false;
  try {
    return NETWORK_TEXT.test(plainPath(path));
  } catch (err) {
    if (isPathRefusal(err)) return true;
    throw err;
  }
}
