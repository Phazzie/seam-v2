// Short builders for hook inputs, and the checks every cheat ends with. Keeping them here
// lets each cheat file read as: set up an app, do the sneaky thing, expect a refusal.
import { expect } from 'vitest';
import type { HookInput } from '../../src/types.ts';
import { asMain } from './app.ts';
import type { App, HookResult, Who } from './app.ts';

type Input = Partial<HookInput> & { hook_event_name: string };

/** A PreToolUse call: the tool is about to run. */
export const pre = (tool: string, toolInput: Record<string, unknown>, who: Who = asMain()): Input => ({
  hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, ...who,
});

/** A PostToolUse call: the tool has already run. */
export const post = (tool: string, toolInput: Record<string, unknown>, who: Who = asMain()): Input => ({
  hook_event_name: 'PostToolUse', tool_name: tool, tool_input: toolInput, tool_response: { stdout: '', stderr: '' }, ...who,
});

export const write = (app: App, rel: string, content: string, who?: Who): Input =>
  pre('Write', { file_path: app.abs(rel), content }, who);

export const edit = (app: App, rel: string, oldText: string, newText: string, who?: Who): Input =>
  pre('Edit', { file_path: app.abs(rel), old_string: oldText, new_string: newText }, who);

export const run = (tool: 'Bash' | 'PowerShell', command: string, who?: Who): Input =>
  pre(tool, { command }, who);

/** Every fail-closed reason the guard emits contains this phrase (Ruling R16). */
const FAIL_CLOSED = /blocked to be safe/i;

/** What the hook did, for a failure message. */
function seen(r: HookResult): string {
  const notes = [r.outputError, r.stdinError && `stdin: ${r.stdinError}`].filter(Boolean).join('; ');
  return `exit ${r.exitCode}, stdout: ${r.stdout.trim() || '(empty)'}, stderr: ${r.stderr.trim() || '(empty)'}${notes ? `, note: ${notes}` : ''}`;
}

/** A refusal for a rule, not a crash: a guard that crashed also refuses, and must not pass these. */
function expectReason(r: HookResult, reason: RegExp | undefined, failClosed: boolean): void {
  expect(r.reason, 'a refusal needs a reason').not.toBe('');
  if (failClosed) expect(r.reason).toMatch(FAIL_CLOSED);
  else expect(r.reason, 'that is the guard failing closed, not the rule being applied').not.toMatch(FAIL_CLOSED);
  if (reason) expect(r.reason).toMatch(reason);
}

/**
 * The hook must refuse before the tool runs, in words, and (if given) the words must match.
 * The reason must come from the rule, not from the guard failing closed, unless the test says
 * `failClosed: true` (only the cheat 20 tests do).
 */
export function expectDenied(r: HookResult, reason?: RegExp, opts: { failClosed?: boolean } = {}): void {
  expect(r.denied, `the hook allowed it (${seen(r)})`).toBe(true);
  expectReason(r, reason, opts.failClosed ?? false);
}

/** After the tool ran, the hook must block (and put things back); the words must match if given. */
export function expectBlocked(r: HookResult, reason?: RegExp): void {
  expect(r.blocked, `the hook let it stand (${seen(r)})`).toBe(true);
  expectReason(r, reason, false);
}

/** A legitimate action: the hook must stay silent, neither refusing nor blocking. */
export function expectAllowed(r: HookResult): void {
  expect(r.denied || r.blocked, `the hook refused a legitimate action (${seen(r)})`).toBe(false);
}

/** A reason the owner can read: no stack frames, no file:line:col, no Node internals. */
export function expectPlain(reason: string): void {
  expect(reason).not.toMatch(/\n\s+at \S|node:internal|\.mjs:\d+|\.ts:\d+/);
}
