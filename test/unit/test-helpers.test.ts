// The cheat tests trust interpret() and expectAllowed(), so they are tested here: a hook that prints
// something other than a refusal or silence, or that crashes, must never read as "allowed".
import { describe, expect, test } from 'vitest';
import { expectAllowed } from '../helpers/calls.ts';
import { interpret } from '../helpers/run.ts';
import type { ProcResult } from '../helpers/run.ts';

const proc = (stdout: string, extra: Partial<ProcResult> = {}): ProcResult => ({
  stdout, stderr: '', exitCode: 0, ms: 5, stdinError: '', ...extra,
});
const preDecision = (permissionDecision: string): string =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: 'x' } });

describe('interpret', () => {
  test.each(['allow', 'ask'])('output with permissionDecision "%s" is a bug and throws', (decision) => {
    expect(() => interpret(proc(preDecision(decision)))).toThrow(new RegExp(`permissionDecision "${decision}"`));
  });

  test('a top-level decision "approve" is a bug and throws', () => {
    expect(() => interpret(proc(JSON.stringify({ decision: 'approve', reason: 'fine' })))).toThrow(/decision "approve"/);
  });

  test('deny and block are read as a refusal with their reason', () => {
    expect(interpret(proc(preDecision('deny')))).toMatchObject({ denied: true, blocked: false, reason: 'x' });
    expect(interpret(proc(JSON.stringify({ decision: 'block', reason: 'later' })))).toMatchObject({ denied: false, blocked: true, reason: 'later' });
  });
});

describe('expectAllowed', () => {
  test('silence with a clean exit is allowed', () => {
    expect(() => expectAllowed(interpret(proc('')))).not.toThrow();
  });

  test('a crash (exit code 1) is not allowed, even though Claude Code would let the call through', () => {
    expect(() => expectAllowed(interpret(proc('', { exitCode: 1, stderr: 'Error: boom' })))).toThrow(/did not exit cleanly/);
  });

  test('output that is not JSON is not allowed', () => {
    expect(() => expectAllowed(interpret(proc('Error: something broke')))).toThrow(/not what Claude Code reads/);
  });

  test('a refusal is not allowed', () => {
    expect(() => expectAllowed(interpret(proc(preDecision('deny'))))).toThrow(/refused a legitimate action/);
  });
});
