// The hook's front door (runHook): unreadable requests, folders that are not seam projects, a seam
// project whose records are gone, the guard crashing or stalling, and the one tool it never stops.
// Every refusal the guard makes because it could not decide contains "blocked to be safe" (R16).
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { GUARD_TIMEOUT_MS } from '../../src/guard/deadline.ts';
import { runHook } from '../../src/guard/run.ts';
import { makeApp } from '../helpers/app.ts';
import { post, pre, write } from '../helpers/calls.ts';
import { blocksOf, call, envFor, logOf, printed, reasonOf } from '../helpers/inproc.ts';
import { tempDir } from '../helpers/project.ts';

const COULDNT_READ = "seam guard couldn't read the request, so it was blocked to be safe";
const PHRASE = /blocked to be safe/;
const SILENT = { stdout: '', exitCode: 0 };

describe('output format', () => {
  test('a PreToolUse refusal is the deny JSON, exit 0', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, write(app, 'notes.md', 'x'), { env: envFor(app, { SEAM_TEST_FORCE_THROW: '1' }) });
    expect(out.exitCode).toBe(0);
    expect(printed(out)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'seam guard hit an internal error and blocked to be safe: SEAM_TEST_FORCE_THROW is set',
      },
    });
  });

  test('a PostToolUse refusal is the block JSON, exit 0', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, post('Bash', { command: 'ls' }), { env: envFor(app, { SEAM_TEST_FORCE_THROW: '1' }) });
    expect(out.exitCode).toBe(0);
    expect(printed(out)).toEqual({ decision: 'block', reason: 'seam guard hit an internal error and blocked to be safe: SEAM_TEST_FORCE_THROW is set' });
  });
});

describe('a request the guard cannot read is refused', () => {
  const env = {};
  test.each([
    ['empty input', ''],
    ['text that is not JSON', 'not json'],
    ['JSON cut off in the middle', '{"hook_event_name": "PreToolUse", "tool_na'],
    ['a list', '[]'],
    ['null', 'null'],
    ['a string', '"PreToolUse"'],
    ['an object with no event', '{}'],
    ['an event that is not text', '{"hook_event_name": 7}'],
    ['a tool_input that is text', '{"hook_event_name":"PreToolUse","tool_name":"Write","cwd":"/x","tool_input":"hi"}'],
    ['a tool_input that is a list', '{"hook_event_name":"PreToolUse","tool_name":"Write","cwd":"/x","tool_input":[]}'],
    ['a tool_input that is null', '{"hook_event_name":"PreToolUse","tool_name":"Write","cwd":"/x","tool_input":null}'],
    ['no tool_name', '{"hook_event_name":"PreToolUse","cwd":"/x","tool_input":{}}'],
    ['a tool_name that is not text', '{"hook_event_name":"PreToolUse","tool_name":4,"cwd":"/x"}'],
    ['no cwd', '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{}}'],
  ])('%s is denied with the plain reason', async (_what, raw) => {
    const out = await runHook(raw, env);
    expect(out.exitCode).toBe(0);
    expect(printed(out)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: COULDNT_READ },
    });
    expect(out.note, 'the owner needs the real cause somewhere').toMatch(/could not be read/);
  });

  test('a PostToolUse request that cannot be read is blocked, not denied', async () => {
    for (const raw of ['{"hook_event_name":"PostToolUse","tool_na', '{"hook_event_name":"PostToolUse","tool_name":"Write","cwd":"/x","tool_input":"hi"}']) {
      expect(printed(await runHook(raw, env))).toEqual({ decision: 'block', reason: COULDNT_READ });
    }
  });

  test('a byte-order mark in front of good JSON is not a reason to refuse', async () => {
    const raw = `\uFEFF${JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', cwd: tempDir(), tool_input: {} })}`;
    expect(await runHook(raw, env)).toEqual(SILENT);
  });

  test('an event the guard is not asked about gets silence, whatever else is in it', async () => {
    for (const event of ['SubagentStart', 'SubagentStop', 'Stop', 'SessionStart']) {
      expect(await runHook(JSON.stringify({ hook_event_name: event, cwd: tempDir() }), env)).toEqual(SILENT);
    }
  });
});

describe('not a seam project: the guard says nothing and touches nothing', () => {
  test.each([
    ['a write', pre('Write', { file_path: 'x.ts', content: 'hi' })],
    ['a command', pre('Bash', { command: 'rm -rf /' })],
    ['a read', pre('Read', { file_path: 'x.ts' })],
    ['something after a tool ran', post('Bash', { command: 'ls' })],
  ])('%s: empty output, exit 0, nothing written', async (_what, input) => {
    const app = await makeApp({ phase: 'build' });
    const elsewhere = tempDir();
    const dataBefore = readdirSync(app.dataDir).sort();
    // Every switch that would make it refuse is set: in a folder that is not a seam project none of them matter.
    const env = envFor(app, { SEAM_TEST_FORCE_THROW: '1', SEAM_TEST_FORCE_HANG: '1' });
    expect(await call(app, input, { cwd: elsewhere, env })).toEqual(SILENT);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(readdirSync(app.dataDir).sort()).toEqual(dataBefore);
  });

  test('it stays silent even with no plugin folders in the environment at all', async () => {
    expect(await runHook(JSON.stringify({ ...pre('Write', { file_path: 'a.ts' }), cwd: tempDir() }), {})).toEqual(SILENT);
  });
});

describe('a seam project whose records are gone', () => {
  test('is refused for a call before and after a tool, and nothing is made in its place', async () => {
    const app = await makeApp({ phase: 'build' });
    rmSync(join(app.root, '.seam'), { recursive: true, force: true });
    const reason = "this seam project's records (.seam) are missing; ask the owner";
    expect(printed(await call(app, write(app, 'notes.md', 'x')))).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    });
    expect(printed(await call(app, post('Bash', { command: 'ls' })))).toEqual({ decision: 'block', reason });
    expect(readdirSync(app.root)).not.toContain('.seam');
  });

  test('is refused from a folder inside it, too', async () => {
    const app = await makeApp({ phase: 'build' });
    rmSync(join(app.root, '.seam'), { recursive: true, force: true });
    const inside = join(app.root, 'deep', 'er');
    mkdirSync(inside, { recursive: true });
    expect(reasonOf(await call(app, pre('Read', { file_path: 'a.ts' }), { cwd: inside }))).toMatch(/records \(\.seam\) are missing/);
  });
});

describe('the guard failing', () => {
  test('a crash inside the decision is a refusal that says so, is counted, and is logged', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, write(app, 'notes.md', 'x'), { env: envFor(app, { SEAM_TEST_FORCE_THROW: '1' }) });
    expect(reasonOf(out)).toMatch(PHRASE);
    expect(blocksOf(app)).toBe(1);
    expect(logOf(app.root)).toMatch(/^\d\d:\d\d Blocked: main tried Write on .*notes\.md: seam guard hit an internal error and blocked to be safe/);
  });

  test('a stall ends in a refusal when the time is up, and is counted', async () => {
    const app = await makeApp({ phase: 'build' });
    const started = Date.now();
    const out = await call(app, write(app, 'notes.md', 'x'), { env: envFor(app, { SEAM_TEST_FORCE_HANG: '1' }), timeoutMs: 300 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(reasonOf(out)).toBe('seam guard took too long to decide, so it was blocked to be safe');
    expect(blocksOf(app)).toBe(1);
  });

  test('the guard gives itself 20 seconds, inside the 30 the hook is allowed', () => {
    expect(GUARD_TIMEOUT_MS).toBe(20_000);
  });

  test('state that cannot be read is a refusal, and the reason says the block could not be recorded', async () => {
    const app = await makeApp({ phase: 'build' });
    app.writeRaw('.seam/state.json', '{ this is not json');
    const reason = reasonOf(await call(app, write(app, 'notes.md', 'x')));
    expect(reason).toMatch(/^seam guard hit an internal error and blocked to be safe: .*state\.json/);
    expect(reason).toMatch(/this block could not be recorded/);
  });

  test('no plugin data folder in the environment means a seam project is refused', async () => {
    const app = await makeApp({ phase: 'build' });
    const reason = reasonOf(await call(app, write(app, 'notes.md', 'x'), { env: { CLAUDE_PLUGIN_ROOT: app.pluginRoot } }));
    expect(reason).toMatch(/^seam guard hit an internal error and blocked to be safe: CLAUDE_PLUGIN_DATA or CLAUDE_PLUGIN_ROOT is not set/);
  });

  test('a record that is not text in a path field is refused as unreadable', async () => {
    const app = await makeApp({ phase: 'build' });
    const bad = { ...pre('Read', {}), tool_input: { file_path: 42 } };
    expect(reasonOf(await call(app, bad))).toBe(COULDNT_READ);
    expect(blocksOf(app)).toBe(1);
  });
});
