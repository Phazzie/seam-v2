// Counting a refusal: one more block in the state, and one plain line in the log.
import { roleOf } from '../lib/roles.ts';
import { recordBlock } from '../lib/store.ts';
import type { HookInput } from '../types.ts';
import { describeError } from './output.ts';
import type { HookEvent } from './output.ts';
import { fieldTargetsOf } from './request.ts';

const COMMAND_SNIPPET = 80;

/** What happened, for the log: `tried Write on src/a.ts: <reason>`. */
export function whatHappened(input: HookInput, event: HookEvent, reason: string): string {
  const [target] = fieldTargetsOf(input);
  const command = input.tool_input?.command;
  let where = '';
  if (target !== undefined) where = ` on ${target}`;
  else if (typeof command === 'string') where = ` "${command.slice(0, COMMAND_SNIPPET)}"`;
  const what = `${input.tool_name ?? 'a tool'}${where}`;
  return event === 'PostToolUse' ? `${what} left a problem: ${reason}` : `tried ${what}: ${reason}`;
}

/** Record a refusal in the project. Returns '' when it worked, or a plain sentence saying why it did not. */
export function recordRefusal(root: string, dataDir: string, input: HookInput, event: HookEvent, reason: string): string {
  try {
    recordBlock(root, dataDir, roleOf(input), whatHappened(input, event, reason));
    return '';
  } catch (err) {
    return `this block could not be recorded: ${describeError(err)}`;
  }
}
