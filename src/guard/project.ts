// Which seam project a tool call belongs to. The session's folder says one thing and the file a tool
// names can say another (Claude Code can be started in a folder that is not the project, or in one
// project while the call names a file in a second), so both are asked (Ruling R21) and the stricter
// answer wins: `missing` beats `seam`, and `seam` beats `none`.
import { isPathRefusal } from '../lib/pathcheck.ts';
import { findProject, resolveReal } from '../lib/paths.ts';
import type { ProjectLookup } from '../lib/paths.ts';
import type { HookInput } from '../types.ts';
import { describeError, internalError, TWO_PROJECTS } from './output.ts';
import { targetsOf } from './request.ts';

/**
 * `problem` is set when the call is for a seam project but cannot be allowed to go on, with the reason why.
 * `doubt` is set when a path could not be looked at and nothing else showed a seam project: the call is
 * left alone, and the cause is said on stderr.
 */
export type Found =
  | { kind: 'none'; doubt?: string }
  | { kind: 'missing'; root: string }
  | { kind: 'seam'; root: string; problem: string | null };

const fromLookup = (lookup: ProjectLookup): Found => (lookup.kind === 'seam' ? { ...lookup, problem: null } : lookup);

/** Fold in what the folder of one named file said. */
function merge(found: Found, there: ProjectLookup): Found {
  if (found.kind === 'missing' || there.kind === 'none') return found;
  if (there.kind === 'missing') return there;
  if (found.kind === 'none') return fromLookup(there);
  return found.root === there.root ? found : { ...found, problem: found.problem ?? TWO_PROJECTS };
}

/**
 * Look for a project from the session's folder and from every path the call names. A path that cannot be
 * looked at (the path code refuses it on purpose, as with a network path, or the file system will not
 * answer, as with `C:\pagefile.sys` or `System Volume Information`) is not known to be anything. If
 * nothing else shows a seam project the call is left alone and the cause is passed on as `doubt`. If the
 * session folder or another path does show one, the call is refused for it: with the path code's own words
 * for a refusal, and as an internal error for anything else.
 */
export function resolveProject(input: HookInput, dataDir: string): Found {
  const starts = [() => input.cwd, ...targetsOf(input).map((target) => () => resolveReal(input.cwd, target))];
  let found: Found = { kind: 'none' };
  let doubted = false;
  let doubt: unknown;
  for (const start of starts) {
    try {
      found = merge(found, findProject(start(), dataDir));
    } catch (err) {
      if (!doubted) doubt = err;
      doubted = true;
    }
  }
  if (!doubted) return found;
  if (found.kind === 'none') return { kind: 'none', doubt: describeError(doubt) };
  if (found.kind === 'seam' && found.problem === null) {
    return { ...found, problem: isPathRefusal(doubt) ? doubt.message : internalError(doubt) };
  }
  return found;
}
