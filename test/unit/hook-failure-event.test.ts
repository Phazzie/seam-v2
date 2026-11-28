// M-1: a PostToolUseFailure (the tool ran and failed) has the shape of a PostToolUse plus the error, and the hooks
// docs give it the same top-level block for an answer. The hook handles it as a PostToolUse, so Task 14 can wire it
// in hooks.json: a tool that failed half way may still have changed a protected file.
import { describe, expect, test } from 'vitest';
import { parseInput, prepare, sniffEvent } from '../../src/guard/request.ts';
import { makeApp } from '../helpers/app.ts';
import { expectAllowed, expectBlocked } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';
import { call, logOf, printed } from '../helpers/inproc.ts';
import { longerPlan } from '../helpers/tamper.ts';

const failed = (tool: string, toolInput: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  hook_event_name: 'PostToolUseFailure', tool_name: tool, tool_input: toolInput, error: 'Command exited with non-zero status code 1', is_interrupt: false, ...extra,
});
const raw = (cwd: string, input: Record<string, unknown>): string => JSON.stringify({ cwd, session_id: 's', ...input });

describe('reading a PostToolUseFailure', () => {
  test('it is a tool event after the tool ran: the same event as a PostToolUse', () => {
    const parsed = parseInput(raw('/x', failed('Bash', { command: 'x' })));
    expect(parsed).toMatchObject({ ok: true, event: 'PostToolUse', input: { hook_event_name: 'PostToolUseFailure', error: expect.any(String) } });
  });

  test('an unreadable one is refused as a PostToolUse is (a block), and a cut-off one is told by its event', () => {
    expect(parseInput(raw('/x', failed('Bash', {}, { tool_name: 7 })))).toMatchObject({ ok: false, event: 'PostToolUse' });
    expect(sniffEvent('{"session_id":"s","hook_event_name":"PostToolUseFailure","tool_na')).toBe('PostToolUse');
    expect(sniffEvent('{"hook_event_name":"PostToolUse"')).toBe('PostToolUse');
    expect(sniffEvent('{"hook_event_name":"PostToolUseSomethingElse"')).toBe('PreToolUse');
  });

  test('SubagentHandback is left alone under this event as under the others (R9)', () => {
    expect(prepare(raw('/x', failed('SubagentHandback', { message: 'x' })))).toEqual({ done: { stdout: '', exitCode: 0 } });
  });
});

describe('the tamper check for a PostToolUseFailure', () => {
  test('a protected file changed by the tool that failed is blocked and put back, in the PostToolUse block form', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const original = app.read('plan/plan.json');
    app.writeRaw('plan/plan.json', longerPlan(app));
    const out = await call(app, failed('Bash', { command: 'false' }));
    expect(printed(out)).toEqual({ decision: 'block', reason: 'plan/plan.json was changed outside the rules and has been put back' });
    expect(app.read('plan/plan.json')).toBe(original);
    expect(logOf(app.root)).toMatch(/Blocked: main Bash .* left a problem/);
  });

  test('an unchanged project says nothing', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    expect(await call(app, failed('Bash', { command: 'false' }))).toEqual({ stdout: '', exitCode: 0 });
  });

  test('through the real hook (dist) too, with an MCP tool that failed', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    expectAllowed(await app.hook(failed('mcp__claude_ai_Slack__slack_send_message', {})));
    const skeleton = app.read(TOTAL);
    app.writeRaw(TOTAL, `${skeleton}// changed\n`);
    expectBlocked(await app.hook(failed('mcp__claude_ai_Slack__slack_send_message', {})), /src\/pricing\/total\.ts was changed outside the rules/);
    expect(app.read(TOTAL)).toBe(skeleton);
  });
});
