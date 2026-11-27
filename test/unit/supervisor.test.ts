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

const input = { hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: dir, tool_input: {} };
const run = (workerUrl: URL, extra: Partial<Supervision> = {}): Promise<{ stdout: string; exitCode: number }> =>
  supervise({ workerUrl, raw: '{}', env: {}, input, event: 'PreToolUse', timeoutMs: 400, ...extra });
const denial = (reason: string): string =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

describe('supervise', () => {
  test('prints what the worker answers (here: nothing to say)', async () => {
    expect(await run(stub('answers'))).toEqual({ stdout: '', exitCode: 0 });
  });

  test('a worker that spins forever is cut off at the time limit with the refusal, not waited for', async () => {
    const started = Date.now();
    const out = await run(stub('spinsQuietly'));
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(out).toEqual({ stdout: denial('seam guard took too long to decide, so it was blocked to be safe'), exitCode: 0 });
  });

  test('after a tool ran, the same refusal is a block', async () => {
    const out = await run(stub('spinsQuietly'), { event: 'PostToolUse' });
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
    const out = await run(stub('spinsAfterSayingWhere'), { env: { CLAUDE_PLUGIN_DATA: dir }, recordMs: 300 });
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason).toBe(
      'seam guard took too long to decide, so it was blocked to be safe (this block could not be recorded: it took too long)',
    );
  });
});
