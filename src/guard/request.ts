// Reading what Claude Code sent on stdin, and finding the paths a tool call names. Kept small on purpose:
// the hook's main thread uses it, and it should not have to load the path and state code just to read a request.
import type { HookInput } from '../types.ts';
import { commandTargets, readingsOf } from './commandtext.ts';
import { COULDNT_READ, describeError, refusal, SILENT } from './output.ts';
import type { HookEvent, HookOutput } from './output.ts';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A request that cannot be read says why (for the owner's debug output) and which refusal to use. */
export type Parsed = { ok: true; input: HookInput; event: HookEvent | null } | { ok: false; event: HookEvent; why: string };

/**
 * Which event a request was for, looked for in the text itself, so a refusal can be worded for it even when
 * the request cannot be parsed (it was cut off, or never finished arriving). A PostToolUse is blocked and
 * anything else is denied, so an event that cannot be told is taken as PreToolUse.
 */
export function sniffEvent(raw: string): HookEvent {
  return /"hook_event_name"\s*:\s*"PostToolUse"/.test(raw) ? 'PostToolUse' : 'PreToolUse';
}

/**
 * Parse the request. It must be a JSON object with a text `hook_event_name`. For a tool event it
 * must also have a text `tool_name` and `cwd`, and a `tool_input` that is an object when there is one.
 * `event` is null for anything the guard is not asked about (it stays silent for those).
 */
export function parseInput(raw: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (err) {
    return { ok: false, event: sniffEvent(raw), why: `it is not valid JSON (${describeError(err)})` };
  }
  if (!isRecord(value) || typeof value.hook_event_name !== 'string') {
    return { ok: false, event: sniffEvent(raw), why: 'it is not a JSON object with a hook_event_name' };
  }
  const name = value.hook_event_name;
  const input = value as unknown as HookInput;
  if (name !== 'PreToolUse' && name !== 'PostToolUse') return { ok: true, input, event: null };
  const shapeOk =
    typeof value.tool_name === 'string' && typeof value.cwd === 'string' && (value.tool_input === undefined || isRecord(value.tool_input));
  if (!shapeOk) return { ok: false, event: name, why: 'tool_name or cwd is not text, or tool_input is not an object' };
  return { ok: true, input, event: name };
}

/** Either the answer already (a request that cannot be read, or one the guard stays out of), or what to decide. */
export type Prepared = { done: HookOutput } | { input: HookInput; event: HookEvent };

/**
 * The part of handling a request that needs no project and no files. A request that cannot be read is
 * refused. An event the guard is not asked about is left alone, and so is SubagentHandback, the call every
 * builder ends on (live check): the guard never stands in its way, so it does not even look.
 */
export function prepare(raw: string): Prepared {
  const parsed = parseInput(raw);
  if (!parsed.ok) return { done: { ...refusal(parsed.event, COULDNT_READ), note: `The request could not be read: ${parsed.why}` } };
  if (parsed.event === null || parsed.input.tool_name === 'SubagentHandback') return { done: SILENT };
  return { input: parsed.input, event: parsed.event };
}

/**
 * The input fields that name a file or folder. `path` is Glob's and Grep's. This is the one list of what a call
 * names: the cheap check (inert.ts) and the full lookup (project.ts) both get it from `targetsOf`, so a field
 * added here (a Bash `cd` target, a Glob pattern) is looked at by both.
 */
export const PATH_FIELDS = ['file_path', 'notebook_path', 'path'] as const;

/** What a path field holds: `null` counts as not there, like leaving the field out. */
const fieldOf = (input: HookInput, field: (typeof PATH_FIELDS)[number]): unknown => input.tool_input?.[field] ?? undefined;

/** The values of the path fields that are text and not empty, as written. */
export function fieldTargetsOf(input: HookInput): string[] {
  return PATH_FIELDS.map((field) => fieldOf(input, field)).filter((v): v is string => typeof v === 'string' && v !== '');
}

const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * What narrows a search to some files: a Glob's `pattern` and a Grep's `glob` (a Grep's `pattern` is text to find,
 * not a path). Undefined for any other tool, and for a field that is empty or not text.
 */
export function filterOf(input: HookInput): string | undefined {
  const tool = input.tool_name;
  const value = tool === 'Glob' ? input.tool_input?.pattern : tool === 'Grep' ? input.tool_input?.glob : undefined;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The folder (or file, when there is no wildcard) a pattern starts from: its text before the first wildcard, cut back
 * to the last separator and keeping it. `C:/proj/tests/**` is `C:/proj/tests/`; `**` and `*.ts` start from nowhere, ''.
 */
export function literalPrefix(pattern: string): string {
  const wild = pattern.search(/[*?[{]/);
  if (wild === -1) return pattern;
  const head = pattern.slice(0, wild);
  return head.slice(0, Math.max(head.lastIndexOf('/'), head.lastIndexOf('\\')) + 1);
}

/** Does this text start at a root rather than at the folder it is used from: a drive, a separator (so a network path too) or `~`? */
export const isRooted = (text: string): boolean => /^(?:[a-z]:|[\\/]|~)/i.test(text);

/** An absolute filter names the place it starts from by itself, whatever `path` says, in every reading of it (R20). */
function filterTargetsOf(input: HookInput): string[] {
  const filter = filterOf(input);
  return filter === undefined || !isRooted(filter) ? [] : readingsOf(literalPrefix(filter));
}

/**
 * Everything the call names: the path fields, and for a shell command the paths and folders it mentions
 * (`commandTargets`, with MSYS, Cygwin and WSL forms made drive paths too, R20). A command run from a folder
 * that is not a seam project, which changes into one or names a path in one, is then that project's (R41). So is a
 * Glob or Grep whose absolute pattern starts in one (R21): the project is asked about where the search really goes.
 */
export function targetsOf(input: HookInput): string[] {
  const command = input.tool_input?.command;
  const mentioned = COMMAND_TOOLS.has(input.tool_name ?? '') && typeof command === 'string' ? commandTargets(command) : [];
  return [...fieldTargetsOf(input), ...mentioned, ...filterTargetsOf(input)];
}

/** Is a path field there but not text (a number, a list)? The tool call is then not one the guard can read. */
export function hasUnreadablePath(input: HookInput): boolean {
  return PATH_FIELDS.some((field) => {
    const v = fieldOf(input, field);
    return v !== undefined && typeof v !== 'string';
  });
}
