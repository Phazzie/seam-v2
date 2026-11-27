// The real bundle, run the way Claude Code runs it: a new `node dist/hook.mjs` process per call with the
// request on stdin. These check what only a real process shows: that the decision modules (loaded
// by `import()` from chunk files) really load, that a folder that is not a seam project gets silence
// and nothing else, and that a stdin that never ends is still answered inside the guard's time limit.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, expectDenied, expectPlain, post, pre, write } from '../helpers/calls.ts';
import { tempDir } from '../helpers/project.ts';

const DIST = resolve(import.meta.dirname, '../../dist');

describe('dist/ holds every file the hook loads', () => {
  test('the worker is next to the hook, and the hook names it', () => {
    expect(existsSync(join(DIST, 'hook-worker.mjs'))).toBe(true);
    expect(readFileSync(join(DIST, 'hook.mjs'), 'utf8')).toContain('hook-worker.mjs');
  });

  test.each(['hook.mjs', 'hook-worker.mjs'])('each chunk %s names is there, and nothing but chunk files is in dist/chunks', (entry) => {
    const named = [...readFileSync(join(DIST, entry), 'utf8').matchAll(/\.\/chunks\/([\w.-]+\.mjs)/g)].map((m) => m[1]);
    expect(named.length, 'the decisions should be loaded from chunks').toBeGreaterThan(0);
    for (const chunk of named) expect(existsSync(join(DIST, 'chunks', chunk)), `${chunk} is missing from dist/chunks`).toBe(true);
    expect(readdirSync(join(DIST, 'chunks')).every((f) => f.endsWith('.mjs'))).toBe(true);
  });
});

describe('each kind of call loads its decision in the real bundle', () => {
  test.each([
    ['a write', (a: App) => write(a, 'notes.md', 'hello\n')],
    ['a command', () => pre('Bash', { command: 'git status' })],
    ['a read', (a: App) => pre('Read', { file_path: a.abs('notes.md') })],
    ['a glob', (a: App) => pre('Glob', { pattern: '*.md', path: a.root })],
    ['a call after a tool', () => post('Bash', { command: 'git status' })],
    ['a call to a tool the guard does not decide', () => pre('Agent', { prompt: 'hi' })],
  ])('%s: the process exits 0 with no output and no error text', async (_what, input) => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(input(app));
    expectAllowed(r);
    expect(r.stderr, 'a module that failed to load would say so here').toBe('');
  });
});

describe('a folder that is not a seam project', () => {
  test('gets silence, exit 0, and nothing is written there', async () => {
    const app = await makeApp({ phase: 'build' });
    const elsewhere = tempDir();
    const r = await app.hook(pre('Write', { file_path: join(elsewhere, 'x.md'), content: 'x' }), { cwd: elsewhere, env: { SEAM_TEST_FORCE_THROW: '1' } });
    expectAllowed(r);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(readdirSync(elsewhere)).toEqual([]);
  });
});

describe('a refusal printed by the real bundle', () => {
  test('is the deny JSON on stdout with exit 0, and the reason reads plainly', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(write(app, 'notes.md', 'x'), { env: { SEAM_TEST_FORCE_THROW: '1' } });
    expect(r.exitCode).toBe(0);
    expect(r.outputError).toBe('');
    expectDenied(r, /SEAM_TEST_FORCE_THROW/, { failClosed: true });
    expectPlain(r.reason);
  });

  test('says why on stderr when it could not read the request', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook({ hook_event_name: 'PreToolUse' }, { stdin: '{ cut off' });
    expectDenied(r, undefined, { failClosed: true });
    expect(r.stderr).toMatch(/could not be read: it is not valid JSON/);
  });
});

describe('a request that never finishes arriving', () => {
  const TOOK_TOO_LONG = 'seam guard took too long to decide, so it was blocked to be safe';

  test.each([
    ['before a tool', '{"hook_event_name":"PreToolUse","tool_name":"Read",', {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: TOOK_TOO_LONG },
    }],
    // Review fix, minor 2: the refusal is worded for the event the text so far says it is for.
    ['after a tool', '{"session_id":"s","hook_event_name":"PostToolUse","tool_name":"Bash","tool_resp', { decision: 'block', reason: TOOK_TOO_LONG }],
    ['with no event in it yet', '{"session_id":"s","transcript_pa', {
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: TOOK_TOO_LONG },
    }],
  ])('is answered with a refusal by the guard itself, when its time is up (%s)', async (_what, partial, expected) => {
    const started = Date.now();
    const env = { ...process.env, SEAM_TEST_TIMEOUT_MS: '1500' };
    const child = spawn(process.execPath, [join(DIST, 'hook.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    child.stdin.write(partial);
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk));
    const code = await new Promise<number | null>((done) => child.on('close', done));
    expect(code).toBe(0);
    expect(Date.now() - started).toBeGreaterThan(1000);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(JSON.parse(stdout)).toEqual(expected);
  }, 30_000);
});
