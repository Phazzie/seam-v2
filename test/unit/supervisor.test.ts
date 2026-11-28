// The supervisor (src/guard/supervisor.ts) with stand-in workers: what the hook's main thread prints when
// the worker answers, never answers, fails, or just stops. A worker that spins in a loop is the case a
// timer on its own thread could never end; here only the supervisor's clock and terminate() can.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { supervise } from '../../src/guard/supervisor.ts';
import type { Supervision } from '../../src/guard/supervisor.ts';
import { tempDir } from '../helpers/project.ts';

const IMPORT = "import { parentPort } from 'node:worker_threads';\n";
const STUBS = {
  answers: `${IMPORT}parentPort.postMessage({ kind: 'answer', out: { stdout: '', exitCode: 0 } });`,
  notesThenAnswers: `${IMPORT}parentPort.postMessage({ kind: 'note', text: 'because' });
parentPort.postMessage({ kind: 'answer', out: { stdout: '', exitCode: 0, note: 'and more' } });`,
  notesThenSpins: `${IMPORT}parentPort.postMessage({ kind: 'note', text: 'because' });
for (;;) { /* never gives the thread back */ }`,
  spinsQuietly: 'for (;;) { /* never gives the thread back */ }',
  spinsAfterSayingWhere: `${IMPORT}parentPort.postMessage({ kind: 'root', root: 'some-project' });\nfor (;;) { /* never gives the thread back */ }`,
  throws: "throw new Error('stub exploded');",
  stops: 'process.exit(0);',
};

const dir = tempDir();
function stub(name: keyof typeof STUBS): URL {
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, STUBS[name]);
  return pathToFileURL(file);
}

/**
 * A worker that answers, throws or stops ends the call at once, so the limit only has to be far longer than a busy
 * machine (the whole suite running at once) takes to start a thread. A worker that spins is the one the limit is for.
 */
const ROOMY_MS = 10_000;
/** The limit for a stand-in that spins whatever happens: it is cut off at the limit, so a short one keeps the test short. */
const SHORT_MS = 400;
/** The limit for a stand-in that has to get a message out before it spins; it is cut off at the limit all the same. */
const MESSAGE_MS = 4000;

const input = { hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: dir, tool_input: {} };
const run = (workerUrl: URL, extra: Partial<Supervision> = {}): Promise<{ stdout: string; exitCode: number }> =>
  supervise({ workerUrl, raw: '{}', env: {}, input, event: 'PreToolUse', timeoutMs: ROOMY_MS, ...extra });
const denial = (reason: string): string =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

describe('supervise', () => {
  test('prints what the worker answers (here: nothing to say)', async () => {
    expect(await run(stub('answers'))).toEqual({ stdout: '', exitCode: 0 });
  });

  test('what the worker says for stderr goes with its answer, and with a refusal made for it', async () => {
    expect(await run(stub('notesThenAnswers'))).toEqual({ stdout: '', exitCode: 0, note: 'because; and more' });
    const refused = await run(stub('notesThenSpins'), { timeoutMs: MESSAGE_MS });
    expect(refused.stdout).toBe(denial('seam guard took too long to decide, so it was blocked to be safe'));
    expect(refused).toMatchObject({ note: 'because' });
  });

  test('a worker that spins forever is cut off at the time limit with the refusal, not waited for', async () => {
    const started = Date.now();
    const out = await run(stub('spinsQuietly'), { timeoutMs: SHORT_MS });
    expect(Date.now() - started).toBeGreaterThanOrEqual(SHORT_MS - 50);
    expect(Date.now() - started).toBeLessThan(15_000); // not waited for: the stand-in never stops, and the guard's own budget is 20 s
    expect(out).toEqual({ stdout: denial('seam guard took too long to decide, so it was blocked to be safe'), exitCode: 0 });
  });

  test('after a tool ran, the same refusal is a block', async () => {
    const out = await run(stub('spinsQuietly'), { event: 'PostToolUse', timeoutMs: SHORT_MS });
    expect(JSON.parse(out.stdout)).toEqual({ decision: 'block', reason: 'seam guard took too long to decide, so it was blocked to be safe' });
  });

  test('a worker that throws is an internal error', async () => {
    const out = await run(stub('throws'));
    expect(out.stdout).toBe(denial('seam guard hit an internal error and blocked to be safe: stub exploded'));
  });

  test('a worker that stops without answering is an internal error', async () => {
    const out = await run(stub('stops'));
    expect(out.stdout).toBe(denial('seam guard hit an internal error and blocked to be safe: the guard worker stopped without answering'));
  });

  test('a worker script that is not there is an internal error', async () => {
    const out = await run(pathToFileURL(join(dir, 'not-there.mjs')));
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason).toMatch(/^seam guard hit an internal error and blocked to be safe: /);
  });

  test('if the worker said which project, a refusal is counted by a second worker, and a count that cannot be made is said so', async () => {
    // The stand-in spins for the counting job too, so the count runs out of time; nothing is written anywhere.
    const out = await run(stub('spinsAfterSayingWhere'), { env: { CLAUDE_PLUGIN_DATA: dir }, timeoutMs: MESSAGE_MS, recordMs: 300 });
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason).toBe(
      'seam guard took too long to decide, so it was blocked to be safe (this block could not be recorded: it took too long)',
    );
  });
});
