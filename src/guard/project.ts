// Which seam project a tool call belongs to. The session's folder says one thing and the file a tool
// names can say another (Claude Code can be started in a folder that is not the project, or in one
// project while the call names a file in a second), so both are asked (Ruling R21) and the stricter
// answer wins: `missing` beats `seam`, and `seam` beats `none`.
import { isPathRefusal } from '../lib/pathcheck.ts';
import { findProject } from '../lib/paths.ts';
import type { ProjectLookup } from '../lib/paths.ts';
import type { HookInput } from '../types.ts';
import { fromCwd, targetsOf } from './input.ts';
import { TWO_PROJECTS } from './output.ts';

/** `problem` is set when the call is for a seam project but cannot be allowed to go on, with the reason why. */
export type Found = { kind: 'none' } | { kind: 'missing'; root: string } | { kind: 'seam'; root: string; problem: string | null };

const fromLookup = (lookup: ProjectLookup): Found => (lookup.kind === 'seam' ? { ...lookup, problem: null } : lookup);

/** Fold in what the folder of one named file said. */
function merge(found: Found, there: ProjectLookup): Found {
  if (found.kind === 'missing' || there.kind === 'none') return found;
  if (there.kind === 'missing') return there;
  if (found.kind === 'none') return fromLookup(there);
  return found.root === there.root ? found : { ...found, problem: found.problem ?? TWO_PROJECTS };
}

/**
 * Look for a project from the session's folder and from every path the call names. A path the path
 * code refuses on purpose (a network path it cannot check) stops a call that is already in a seam
 * project; from a folder that is not one the guard stays out of it. Throws for anything else that goes wrong.
 */
export function resolveProject(input: HookInput, dataDir: string): Found {
  let found = fromLookup(findProject(input.cwd, dataDir));
  let refused: string | null = null;
  for (const target of targetsOf(input)) {
    try {
      found = merge(found, findProject(fromCwd(input, target), dataDir));
    } catch (err) {
      if (!isPathRefusal(err)) throw err;
      refused ??= err.message;
    }
  }
  return found.kind === 'seam' && found.problem === null && refused !== null ? { ...found, problem: refused } : found;
}
