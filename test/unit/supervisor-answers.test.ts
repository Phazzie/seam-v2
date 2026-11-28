// What the hook may print of what its worker answers (review fix, critical 1). Claude Code reads empty or
// unreadable output, and a non-zero exit, as "no decision", which lets the call through. So the supervisor
// prints a worker's answer only if it is exactly silence or the deny/block for the event, with exit code 0;
// anything else becomes the fail-closed refusal. These use stand-in workers that answer with whatever the
// test says, including things the real worker never would.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { supervise } from '../../src/guard/supervisor.ts';
import type { Supervision } from '../../src/guard/supervisor.ts';
import { tempDir } from '../helpers/project.ts';

const dir = tempDir();
let count = 0;
/** A worker script that posts this message (as JSON, so `undefined` fields are simply absent) and ends. */
function workerSaying(message: unknown): URL {
  count += 1;
  const file = join(dir, `says-${count}.mjs`);
  writeFileSync(file, `import { parentPort } from 'node:worker_threads';\nparentPort.postMessage(${JSON.stringify(message)});\n`);
  return pathToFileURL(file);
}

const input = { hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: dir, tool_input: {} };
// The stand-ins answer at once and the call ends then, so the limit only has to be far longer than a busy machine
// (the whole suite running at once) takes to start a thread: a slow start must not look like a worker that never answered.
const run = (workerUrl: URL, event: Supervision['event'] = 'PreToolUse') =>
  supervise({ workerUrl, raw: '{}', env: {}, input, event, timeoutMs: 15_000 });
const answer = (out: unknown): unknown => ({ kind: 'answer', out });

const deny = (reason: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const block = (reason: string) => JSON.stringify({ decision: 'block', reason });
const REFUSED = /^seam guard hit an internal error and blocked to be safe: the guard worker gave an answer that is not one the hook can print \(/;

async function expectRefused(message: unknown, event: Supervision['event'] = 'PreToolUse', why?: RegExp): Promise<void> {
  const out = await run(workerSaying(message), event);
  expect(out.exitCode).toBe(0);
  const body = JSON.parse(out.stdout) as { reason?: string; hookSpecificOutput?: { permissionDecisionReason?: string } };
  const reason = event === 'PostToolUse' ? body.reason : body.hookSpecificOutput?.permissionDecisionReason;
  expect(reason).toMatch(REFUSED);
  if (why) expect(reason).toMatch(why);
}

describe('a worker answer that is not silence or the refusal for the event', () => {
  test.each([
    ['an empty object', answer({}), /its output was not text/],
    ['null', answer(null), /it was not an object/],
    ['no out at all', { kind: 'answer' }, /it was not an object/],
    ['output with no exit code', answer({ stdout: 'hello' }), /its output was not|exit code was undefined/],
    ['plain text and exit 0', answer({ stdout: 'hello', exitCode: 0 }), /not JSON/],
    ['empty output and exit 1', answer({ stdout: '', exitCode: 1 }), /exit code was 1, not 0/],
    ['a refusal and exit 1', answer({ stdout: deny('no'), exitCode: 1 }), /exit code was 1/],
    ['output that is not text', answer({ stdout: 5, exitCode: 0 }), /output was not text/],
    ['a note that is not text', answer({ stdout: '', exitCode: 0, note: 5 }), /note was not text/],
    ['a deny with an empty reason', answer({ stdout: deny(''), exitCode: 0 }), /no reason/],
    ['JSON with no reason', answer({ stdout: '{}', exitCode: 0 }), /no reason/],
    ['the block shape before a tool', answer({ stdout: block('late'), exitCode: 0 }), /no reason/],
    ['an allow', answer({ stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'ok' } }), exitCode: 0 }), /not the deny/],
    ['a deny with an extra field', answer({ stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'x', extra: 1 } }), exitCode: 0 }), /not the deny/],
    ['a top-level approve', answer({ stdout: JSON.stringify({ decision: 'approve', reason: 'fine' }), exitCode: 0 }), /no reason/],
    ['a message the hook does not understand', { kind: 'shrug' }, undefined],
    ['a message that is not an object', null, undefined],
  ])('before a tool, %s is refused, not printed', async (_what, message, why) => {
    if (why === undefined) {
      const out = await run(workerSaying(message));
      expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason).toMatch(/blocked to be safe: the guard worker sent a message/);
    } else {
      await expectRefused(message, 'PreToolUse', why);
    }
  });

  test.each([
    ['the deny shape after a tool', answer({ stdout: deny('late'), exitCode: 0 }), /no reason/],
    ['an object with an extra field', answer({ stdout: JSON.stringify({ decision: 'block', reason: 'x', extra: 1 }), exitCode: 0 }), /not the block/],
    ['plain text', answer({ stdout: 'hello', exitCode: 0 }), /not JSON/],
    ['an empty object', answer({}), /its output was not text/],
  ])('after a tool, %s is refused as a block, not printed', async (_what, message, why) => {
    await expectRefused(message, 'PostToolUse', why);
  });
});

describe('a worker answer that is fine is printed as it is', () => {
  test.each([
    ['silence', 'PreToolUse', { stdout: '', exitCode: 0 }],
    ['a deny before a tool', 'PreToolUse', { stdout: deny('only builders write app code'), exitCode: 0 }],
    ['silence after a tool', 'PostToolUse', { stdout: '', exitCode: 0 }],
    ['a block after a tool', 'PostToolUse', { stdout: block('a was put back'), exitCode: 0 }],
    ['a refusal with a note for stderr', 'PreToolUse', { stdout: deny('x'), exitCode: 0, note: 'why' }],
  ] as const)('%s', async (_what, event, out) => {
    expect(await run(workerSaying(answer(out)), event)).toEqual(out);
  });
});
