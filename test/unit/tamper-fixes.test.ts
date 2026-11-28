// Review fixes for the tamper check (ruling R71): a write in flight is not another call's tamper (I-1), a record file
// overwritten with unreadable text is put back and charged (I-2), Claude Code's own settings.local.json is never
// undone (I-4), and a clean check ends a run of unattributed changes (M-2).
import { existsSync, rmSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { finished, started } from '../../src/guard/inflight.ts';
import { asBuilder, makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { post, pre, write } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';
import { call, logOf, printed, reasonOf } from '../helpers/inproc.ts';
import { ctxOf, decideFor, longerPlan, problemsOf, quarantined, recordOf, stateOf } from '../helpers/tamper.ts';

const PLAN = 'plan/plan.json';
const ALLOW = { kind: 'allow' };
const turn = { file: TOTAL, agentId: 'builder-1' };
const bash = (id = 'bash-1') => ({ ...post('Bash', { command: 'git status' }), tool_use_id: id });

describe('I-1: a write that is under way is left alone by every other call\'s check', () => {
  test('a builder Write in flight, then a main Read\'s Post, then the builder\'s Post: the file is kept and nothing is tamper', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    const writing = { ...write(app, TOTAL, total(), asBuilder('builder-1')), tool_use_id: 'w-1' };
    expect(await decideFor(app, writing)).toEqual(ALLOW);
    app.writeRaw(TOTAL, total()); // the tool has written
    expect(await decideFor(app, { ...post('Read', { file_path: app.abs('notes.md') }), tool_use_id: 'r-1' })).toEqual(ALLOW);
    expect(app.read(TOTAL)).toBe(total());
    expect(await decideFor(app, { ...writing, hook_event_name: 'PostToolUse' })).toEqual(ALLOW);
    expect(await decideFor(app, bash())).toEqual(ALLOW);
    expect(app.read(TOTAL)).toBe(total());
    expect(logOf(app.root)).not.toMatch(/put back|unattributed|moved|strike|halted/i);
    expect(stateOf(app)).toMatchObject({ halted: null, strikes: {} });
    expect(recordOf(app).files[TOTAL].size).toBe(Buffer.byteLength(total()));
  });

  test('a full check by another call (a command) leaves it alone too, also a new file the write made', async () => {
    const app = await makeApp({ phase: 'tests', snapshot: true });
    const writing = { ...write(app, 'tests/new.test.ts', 'x\n'), tool_use_id: 'w-2' };
    expect(await decideFor(app, writing)).toEqual(ALLOW);
    app.writeRaw('tests/new.test.ts', 'x\n');
    expect(await decideFor(app, bash('b-2'))).toEqual(ALLOW);
    expect(app.read('tests/new.test.ts')).toBe('x\n');
    expect(quarantined(app)).toEqual([]);
    expect(await decideFor(app, { ...writing, hook_event_name: 'PostToolUse' })).toEqual(ALLOW);
    expect(recordOf(app).files['tests/new.test.ts']).toBeDefined();
  });

  test('it is only that file: another change found by the same check is still put back', async () => {
    const app = await makeApp({ phase: 'plan2', snapshot: true });
    expect(await decideFor(app, { ...write(app, PLAN, longerPlan(app)), tool_use_id: 'w-3' })).toEqual(ALLOW);
    app.writeRaw(PLAN, longerPlan(app));
    app.writeRaw('.seam/env.json', '{}');
    const out = await decideFor(app, bash('b-3'));
    expect(out).toEqual({ kind: 'deny', reason: '.seam/env.json was changed outside the rules and has been put back' });
    expect(app.read(PLAN)).toContain('"zod"');
  });

  test('finished() says which files the other calls were let through for', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    started(ctxOf(app), { cwd: app.root, ...write(app, TOTAL, 'x'), tool_use_id: 'a' }, ['src/pricing/total.ts']);
    started(ctxOf(app), { cwd: app.root, ...bash('b') }, []);
    expect(finished(ctxOf(app), { cwd: app.root, ...bash('b') })).toEqual({ paths: [], others: 1, otherPaths: ['src/pricing/total.ts'] });
  });
});

describe('I-2: a plan, lock or state file overwritten with text the guard cannot read is put back, and charged', () => {
  test.each([PLAN, '.seam/lock.json', '.seam/state.json'])('%s: restored, reported plainly, the main AI halted, the log says so without the text', async (path) => {
    const app = await makeApp({ phase: 'build', lock: true });
    const original = JSON.parse(app.read(path));
    app.writeRaw(path, '{ "secret-ish": ');
    const out = await call(app, post('Bash', { command: 'echo hi' }));
    expect(printed(out)).toEqual({ decision: 'block', reason: `${path} was changed outside the rules and has been put back` });
    const now = JSON.parse(app.read(path));
    if (path === '.seam/state.json') expect(now.phase).toBe('build');
    else expect(now).toEqual(original);
    expect(stateOf(app).halted).toBe(`the main AI changed a protected file: ${path}`);
    expect(logOf(app.root)).toMatch(new RegExp(`Put back ${path.replaceAll('.', '\\.')}: it had been overwritten with text the guard cannot read`));
    expect(logOf(app.root)).not.toMatch(/secret-ish/);
  });

  test('after a quiet spell of over ten minutes in the build phase it is still put back (the check-in comes first and must not trip on it)', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('.seam/heartbeat.json', JSON.stringify({ lastSeen: new Date(Date.now() - 30 * 60 * 1000).toISOString() }));
    app.writeRaw('.seam/state.json', '{ broken');
    const out = await call(app, post('Bash', { command: 'echo hi' }));
    expect(printed(out)).toEqual({ decision: 'block', reason: '.seam/state.json was changed outside the rules and has been put back' });
    expect(stateOf(app).halted).toBe('the main AI changed a protected file: .seam/state.json');
    expect(JSON.parse(app.read('.seam/heartbeat.json')).gaps).toHaveLength(1);
  });

  test('a builder that does it gets a strike, not a halt', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    app.writeRaw(PLAN, 'not json');
    const out = await call(app, post('Bash', { command: 'x' }, asBuilder('builder-1')));
    expect(reasonOf(out)).toBe(`${PLAN} was changed outside the rules and has been put back`);
    expect(stateOf(app)).toMatchObject({ halted: null, strikes: { [TOTAL]: 1 } });
  });

  test('before a tool ran, and with no record to put it back from, the error stands (fail closed)', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(PLAN, 'not json');
    expect(reasonOf(await call(app, pre('Read', { file_path: app.abs('notes.md') })))).toMatch(/blocked to be safe/);
    const bare = await makeApp({ phase: 'build' });
    bare.writeRaw(PLAN, 'not json');
    expect(reasonOf(await call(bare, post('Bash', { command: 'x' })))).toMatch(/blocked to be safe: .*plan\.json/);
  });
});

describe('I-4: .claude/settings.local.json is Claude Code\'s own file', () => {
  const FILE = '.claude/settings.local.json';

  test('a file Claude Code changed is not put back, not charged, not logged, and becomes the record copy', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { [FILE]: '{}\n' } });
    app.writeRaw(FILE, '{"permissions":{"allow":["Bash(ls)"]}}\n');
    expect(await problemsOf(app, bash())).toEqual([]);
    expect(await problemsOf(app, post('Read', { file_path: 'x' }))).toEqual([]);
    expect(app.read(FILE)).toContain('Bash(ls)');
    expect(stateOf(app).halted).toBeNull();
    expect(logOf(app.root)).toBe('');
    expect(recordOf(app).files[FILE]).toBeDefined();
  });

  test('a file it deleted stays deleted, and the record forgets it', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { [FILE]: '{}\n' } });
    rmSync(app.abs(FILE));
    expect(await problemsOf(app, post('Read', { file_path: 'x' }))).toEqual([]);
    expect(existsSync(app.abs(FILE))).toBe(false);
    expect(recordOf(app).files[FILE]).toBeUndefined();
    expect(logOf(app.root)).toBe('');
  });

  test('a file that was not there at the snapshot is not moved aside, and a second check is quiet too', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(FILE, '{}\n');
    expect(await problemsOf(app, bash())).toEqual([]);
    expect(app.read(FILE)).toBe('{}\n');
    expect(quarantined(app)).toEqual([]);
    expect(await problemsOf(app, bash())).toEqual([]);
  });

  test('settings.json beside it is still protected', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { '.claude/settings.json': '{}\n' } });
    app.writeRaw('.claude/settings.json', '{"x":1}\n');
    expect(await problemsOf(app, bash())).toEqual(['.claude/settings.json was changed outside the rules and has been put back']);
  });
});

describe('M-2: a check with nothing wrong in it ends a run of unattributed changes', () => {
  test('two unattributed, a clean check, then one more is the first of a new run, not the third', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    started(ctxOf(app), { cwd: app.root, ...bash('other') }, []);
    for (let i = 0; i < 2; i += 1) {
      app.writeRaw(PLAN, longerPlan(app));
      await problemsOf(app, bash());
    }
    expect(recordOf(app).unattributed).toBe(2);
    expect(await problemsOf(app, bash())).toEqual([]);
    expect(recordOf(app).unattributed).toBe(0);
    app.writeRaw(PLAN, longerPlan(app));
    await problemsOf(app, bash());
    expect(recordOf(app).unattributed).toBe(1);
    expect(stateOf(app).halted).toBeNull();
  });
});
