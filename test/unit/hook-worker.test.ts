// The hook's worker thread in the real bundle (R40): the guard's work runs in dist/hook-worker.mjs, and the
// main thread (dist/hook.mjs) keeps the clock and owns the output. A worker that is stuck in a loop is cut
// off, and the refusal is counted; a hook with no worker, or with input it can read without one, behaves.
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { expectAllowed, expectDenied, expectPlain, post, pre, write } from '../helpers/calls.ts';
import { blocksOf, logOf } from '../helpers/inproc.ts';
import { tempDir } from '../helpers/project.ts';
import { interpret, runNode } from '../helpers/run.ts';
import type { HookResult } from '../helpers/run.ts';

/** A stall that never gives the thread back (a busy loop in the worker), with the guard's limit cut to 1.5 s. */
const STALL = { SEAM_TEST_FORCE_HANG: '1', SEAM_TEST_TIMEOUT_MS: '1500' };

describe('a worker stuck in a busy loop', () => {
  test('is cut off when time is up: a deny that says so, in plain words, in a few seconds', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(write(app, 'notes.md', 'x'), { env: STALL });
    expectDenied(r, /took too long to decide/, { failClosed: true });
    expectPlain(r.reason);
    expect(r.exitCode).toBe(0);
    expect(r.ms, 'the loop did not really run, so this tested nothing').toBeGreaterThan(1000);
    expect(r.ms).toBeLessThan(10_000);
  });

  test('is counted and logged, by a second worker, before the hook exits', { retry: 2 }, async () => {
    const app = await makeApp({ phase: 'build' });
    await app.hook(write(app, 'notes.md', 'x'), { env: STALL });
    expect(blocksOf(app)).toBe(1);
    expect(logOf(app.root)).toMatch(/Blocked: main tried Write on .*notes\.md: seam guard took too long to decide/);
  });

  test('after a tool ran, the same stall is a block', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(post('Bash', { command: 'ls' }), { env: STALL });
    expect(r.blocked, 'the hook let it stand').toBe(true);
    expect(r.reason).toMatch(/took too long to decide, so it was blocked to be safe/);
    expect(r.exitCode).toBe(0);
    expect(blocksOf(app)).toBe(1);
  });

  test('a folder that is not a seam project never reaches the stall', async () => {
    const app = await makeApp({ phase: 'build' });
    // A roomy stall limit: if the stall were reached it would last the whole 12 s and end in a refusal, so an allow in
    // well under that means it never ran. (A tight limit would also count a slow start of the process on a busy machine.)
    const env = { SEAM_TEST_FORCE_HANG: '1', SEAM_TEST_TIMEOUT_MS: '12000' };
    const r = await app.hook(pre('Read', { file_path: 'a.ts' }), { env, cwd: tempDir() });
    expectAllowed(r);
    expect(r.ms).toBeLessThan(10_000);
  });
});

describe('the worker missing', () => {
  async function pluginWithoutWorker(): Promise<{ run: (input: object) => Promise<HookResult>; root: string }> {
    const app = await makeApp({ phase: 'build' });
    rmSync(join(app.pluginRoot, 'dist/hook-worker.mjs'));
    const env = { ...process.env, CLAUDE_PLUGIN_DATA: app.dataDir, CLAUDE_PLUGIN_ROOT: app.pluginRoot };
    const run = async (input: object): Promise<HookResult> =>
      interpret(await runNode(join(app.pluginRoot, 'dist/hook.mjs'), [], JSON.stringify(input), app.root, env));
    return { run, root: app.root };
  }

  test('is a refusal that says so, not a crash (a crash would let the call through)', async () => {
    const { run, root } = await pluginWithoutWorker();
    const r = await run({ hook_event_name: 'PreToolUse', tool_name: 'Read', cwd: root, tool_input: { file_path: join(root, 'a.ts') } });
    expectDenied(r, /internal error/, { failClosed: true });
    expect(r.exitCode).toBe(0);
  });

  test('is still fine for what the main thread answers alone: a handback, an event it ignores, a request it cannot read', async () => {
    const { run, root } = await pluginWithoutWorker();
    expectAllowed(await run({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', cwd: root, tool_input: {} }));
    expectAllowed(await run({ hook_event_name: 'SubagentStop', cwd: root }));
    expectDenied(await run({ hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: root, tool_input: 'x' }), /couldn't read the request/, { failClosed: true });
  });

  // The cheap "is a seam project involved" check touches the file system, so it runs in the worker, under the
  // clock (R43), not on the main thread. With no worker nothing can be checked, so even a folder that is not
  // a seam project gets the loud refusal: a broken install is not silent, and it is not a crash.
  test('is a refusal for a folder that is not a seam project too, because even the cheap check needs the worker', async () => {
    const { run } = await pluginWithoutWorker();
    const elsewhere = tempDir();
    const target = { file_path: join(elsewhere, 'x.md'), content: 'x' };
    const r = await run({ hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: elsewhere, tool_input: target });
    expectDenied(r, /internal error/, { failClosed: true });
    expect(r.exitCode).toBe(0);
  });
});

// Review fix, critical 1: an answer that Claude Code would read as "no decision" must never be printed.
describe('a worker that answers with something the hook may not print', () => {
  async function pluginWhoseWorkerSays(out: unknown) {
    const app = await makeApp({ phase: 'build' });
    const script = `import { parentPort } from 'node:worker_threads';\nparentPort.postMessage({ kind: 'answer', out: ${JSON.stringify(out)} });\n`;
    writeFileSync(join(app.pluginRoot, 'dist/hook-worker.mjs'), script);
    const env = { ...process.env, CLAUDE_PLUGIN_DATA: app.dataDir, CLAUDE_PLUGIN_ROOT: app.pluginRoot };
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Read', cwd: app.root, tool_input: { file_path: app.abs('a.ts') } };
    return interpret(await runNode(join(app.pluginRoot, 'dist/hook.mjs'), [], JSON.stringify(input), app.root, env));
  }

  test.each([
    ['an empty object', {}],
    ['null', null],
    ['text that is not JSON', { stdout: 'hello' }],
    ['no output but exit code 1', { stdout: '', exitCode: 1 }],
    ['text and exit code 0', { stdout: 'hello', exitCode: 0 }],
  ])('%s is refused by the real hook, with exit code 0', async (_what, out) => {
    const r = await pluginWhoseWorkerSays(out);
    expectDenied(r, /not one the hook can print/, { failClosed: true });
    expect(r.exitCode).toBe(0);
    expect(r.outputError).toBe('');
  });

  test('a good answer from the same stand-in is still printed', async () => {
    const r = await pluginWhoseWorkerSays({ stdout: '', exitCode: 0 });
    expectAllowed(r);
  });
});
