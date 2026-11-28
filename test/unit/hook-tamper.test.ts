// The tamper check through the real hook (dist/hook.mjs): it runs after every tool, MCP and unknown ones too
// (R42), stays out of SubagentHandback's way (R9), and its block is what Claude Code reads for a PostToolUse.
import { describe, expect, test } from 'vitest';
import { asBuilder, makeApp } from '../helpers/app.ts';
import { expectAllowed, expectBlocked, post } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';
import { longerPlan } from '../helpers/tamper.ts';

const PLAN = 'plan/plan.json';

describe('PostToolUse for every tool', () => {
  test.each(['Bash', 'PowerShell', 'mcp__claude_ai_Slack__slack_send_message', 'SomeFutureTool'])('after %s a changed plan.json is blocked and put back', async (tool) => {
    const app = await makeApp({ phase: 'build', lock: true });
    const original = app.read(PLAN);
    app.writeRaw(PLAN, longerPlan(app));
    expectBlocked(await app.hook(post(tool, {})), /plan\/plan\.json was changed outside the rules and has been put back/);
    expect(app.read(PLAN)).toBe(original);
  });

  test('SubagentHandback is never stopped, even over a tamper (R9); the next tool call finds it', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(PLAN, longerPlan(app));
    expectAllowed(await app.hook(post('SubagentHandback', { message: 'done' }, asBuilder('b-1'))));
    expectBlocked(await app.hook(post('Bash', { command: 'git status' })), /plan\.json/);
  });

  test('an unchanged project answers nothing at all', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn: { file: TOTAL, agentId: 'b-1' } });
    for (const input of [post('Read', { file_path: app.abs(TOTAL) }), post('Bash', { command: 'git status' }), post('Write', { file_path: app.abs('notes.md') })]) {
      const r = await app.hook(input);
      expectAllowed(r);
      expect(r.stdout).toBe('');
    }
  });

  test('the block is the PostToolUse form Claude Code reads: decision "block" with a reason', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(TOTAL, total());
    const r = await app.hook(post('Bash', { command: 'x' }));
    expect(JSON.parse(r.stdout)).toEqual({ decision: 'block', reason: `${TOTAL} was changed outside the rules and has been put back` });
  });
});
