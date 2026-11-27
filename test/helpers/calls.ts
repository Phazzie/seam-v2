// Short builders for hook inputs, and the two checks every cheat ends with. Keeping them here
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

/** The hook must refuse before the tool runs, in words, and (if given) the words must match. */
export function expectDenied(r: HookResult, reason?: RegExp): void {
  const seen = `exit ${r.exitCode}, stdout: ${r.stdout.trim() || '(empty)'}, stderr: ${r.stderr.trim() || '(empty)'}`;
  expect(r.denied, `the hook allowed it (${seen})`).toBe(true);
  expect(r.reason, 'a refusal needs a reason').not.toBe('');
  if (reason) expect(r.reason).toMatch(reason);
}

/** After the tool ran, the hook must block (and put things back); the words must match if given. */
export function expectBlocked(r: HookResult, reason?: RegExp): void {
  const seen = `exit ${r.exitCode}, stdout: ${r.stdout.trim() || '(empty)'}, stderr: ${r.stderr.trim() || '(empty)'}`;
  expect(r.blocked, `the hook let it stand (${seen})`).toBe(true);
  expect(r.reason, 'a block needs a reason').not.toBe('');
  if (reason) expect(r.reason).toMatch(reason);
}

/** A reason the owner can read: no stack frames, no file:line:col, no Node internals. */
export function expectPlain(reason: string): void {
  expect(reason).not.toMatch(/\n\s+at \S|node:internal|\.mjs:\d+|\.ts:\d+/);
}
