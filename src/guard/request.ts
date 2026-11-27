// Reading what Claude Code sent on stdin, and finding the paths a tool call names. Kept small on purpose:
// the hook's main thread uses it, and it should not have to load the path and state code just to read a request.
import type { HookInput } from '../types.ts';
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
