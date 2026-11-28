// What a Read, Glob or Grep looks at, as real places. Text only apart from resolving each path (no parser, no
// project files), so a read decision stays as cheap as the call is simple (R29).
import { resolveReal } from '../lib/paths.ts';
import type { HookInput } from '../types.ts';
import { readingsOf } from './commandtext.ts';
import { fieldTargetsOf, filterOf, isRooted, literalPrefix } from './request.ts';

export interface Look {
  /** Glob and Grep search a place; a Read names one file. */
  searching: boolean;
  /** Where the call looks: each path it names, made real. A search with no `path` has none. */
  roots: string[];
  /** What narrows a search to some files (a Glob's pattern, a Grep's glob), as written. */
  filter: string | undefined;
  /** Where the filter goes by itself: the place an absolute filter starts from, or where `..` climbs to from each root. */
  reaches: string[];
  /** The filter climbs with `..` from somewhere a wildcard stands for, so there is no one place it reaches. */
  unfollowable: boolean;
}

const SEPARATORS = /[\\/]/;
const WILDCARD = /[*?[{]/;
const NOWHERE = { reaches: [], unfollowable: false };

/**
 * Where a filter goes beyond the places the call names. An absolute filter starts at its own folder, whatever `path`
 * says (in every reading of it, R20). A relative one stays under the root unless it climbs with `..`, and then it
 * reaches the folder its literal part ends in. A `..` that comes after a wildcard cannot be followed at all.
 */
function reachOf(filter: string | undefined, roots: string[], cwd: string): Pick<Look, 'reaches' | 'unfollowable'> {
  if (filter === undefined) return NOWHERE;
  const prefix = literalPrefix(filter);
  if (isRooted(filter)) return { reaches: readingsOf(prefix).map((reading) => resolveReal(cwd, reading)), unfollowable: false };
  const parts = filter.split(SEPARATORS);
  const up = parts.indexOf('..');
  if (up === -1) return NOWHERE;
  if (WILDCARD.test(parts.slice(0, up).join('/'))) return { reaches: [], unfollowable: true };
  return { reaches: roots.map((root) => resolveReal(root, prefix)), unfollowable: false };
}

export function lookOf(input: HookInput): Look {
  const roots = fieldTargetsOf(input).map((written) => resolveReal(input.cwd, written));
  const filter = filterOf(input);
  return { searching: input.tool_name !== 'Read', roots, filter, ...reachOf(filter, roots, input.cwd) };
}
