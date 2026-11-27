// Finding the paths a tool call names.
import { resolveReal } from '../lib/paths.ts';
import type { HookInput } from '../types.ts';

/** The input fields that name a file or folder. `path` is Glob's and Grep's. */
const PATH_FIELDS = ['file_path', 'notebook_path', 'path'] as const;

/** What a path field holds: `null` counts as not there, like leaving the field out. */
const fieldOf = (input: HookInput, field: (typeof PATH_FIELDS)[number]): unknown => input.tool_input?.[field] ?? undefined;

/** The values of the path fields that are text and not empty, as written. */
export function targetsOf(input: HookInput): string[] {
  return PATH_FIELDS.map((field) => fieldOf(input, field)).filter((v): v is string => typeof v === 'string' && v !== '');
}

/** Is a path field there but not text (a number, a list)? The tool call is then not one the guard can read. */
export function hasUnreadablePath(input: HookInput): boolean {
  return PATH_FIELDS.some((field) => {
    const v = fieldOf(input, field);
    return v !== undefined && typeof v !== 'string';
  });
}

/**
 * Where a path field really points, taken from the session's folder when it is not absolute. This is
 * resolveReal with the session folder as the root, not the path as a root of its own: a network path is
 * accepted only when it is on the same share as the session, so a path to a foreign host is refused (it
 * throws) before anything asks that host about it.
 */
export const fromCwd = (input: HookInput, target: string): string => resolveReal(input.cwd, target);
