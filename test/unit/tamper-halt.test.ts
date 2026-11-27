// A halted run denies every write and every command (reads stay open), and a file tool's own write is
// accepted by the tamper check only when the guard allowed it before the tool ran.
import { describe, expect, test } from 'vitest';
import { updateState } from '../../src/lib/store.ts';
import { asMain, makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { post, pre, run, write } from '../helpers/calls.ts';
import { decideFor, logText, longerPlan, problemsOf, recordOf, stateOf } from '../helpers/tamper.ts';

const PLAN = 'plan/plan.json';
const REASON = 'the main AI changed a protected file: plan/plan.json';

async function halted(snapshot = false): Promise<App> {
  const app = await makeApp({ phase: 'plan2', snapshot });
  updateState(app.root, app.dataDir, (s) => ({ ...s, halted: REASON }));
  return app;
}

describe('state.halted', () => {
  test.each([
    ['Write', (app: App) => write(app, 'notes.md', 'x')],
    ['Edit', (app: App) => pre('Edit', { file_path: app.abs('notes.md'), old_string: 'a', new_string: 'b' })],
    ['Bash', () => run('Bash', 'git status')],
    ['PowerShell', () => run('PowerShell', 'git status')],
  ])('a %s is denied with the reason, even one that would be fine', async (_tool, make) => {
    const app = await halted();
    const decision = await decideFor(app, make(app));
    expect(decision).toEqual({ kind: 'deny', reason: expect.stringContaining(REASON) });
    expect((decision as { reason: string }).reason).toMatch(/halted/i);
  });

  test.each(['Read', 'Glob', 'Grep'])('a %s is still allowed, so the owner can look', async (tool) => {
    const app = await halted();
    const input = pre(tool, tool === 'Read' ? { file_path: app.abs(PLAN) } : { pattern: '*.json', path: app.root });
    expect(await decideFor(app, input)).toEqual({ kind: 'allow' });
  });

  test('a run that is not halted is not affected', async () => {
    const app = await makeApp({ phase: 'plan2' });
    expect(await decideFor(app, write(app, 'notes.md', 'x'))).toEqual({ kind: 'allow' });
  });

  test('the tamper check goes on while halted, and does not replace the first reason', async () => {
    const app = await halted(true);
    app.writeRaw(PLAN, longerPlan(app));
    expect(await problemsOf(app, post('Bash', { command: 'x' }))).toEqual(['plan/plan.json was changed outside the rules and has been put back']);
    expect(stateOf(app).halted).toBe(REASON);
  });
});

describe('a write the guard allowed is accepted afterwards; one it did not allow is not', () => {
  async function planWrite(allowedFirst: boolean) {
    const app = await makeApp({ phase: 'plan2', lock: false, snapshot: true });
    const edited = longerPlan(app);
    const input = { ...write(app, PLAN, edited, asMain()), tool_use_id: 't-1' };
    if (allowedFirst) expect(await decideFor(app, input)).toEqual({ kind: 'allow' });
    app.writeRaw(PLAN, edited);
    const after = await decideFor(app, { ...input, hook_event_name: 'PostToolUse' });
    return { app, after };
  }

  test('main writes the plan in a planning phase: allowed before, accepted after, still there next time', async () => {
    const { app, after } = await planWrite(true);
    expect(after).toEqual({ kind: 'allow' });
    expect(app.read(PLAN)).toContain('"zod"');
    expect(await decideFor(app, post('Bash', { command: 'x' }))).toEqual({ kind: 'allow' });
  });

  test('the same write when the before-hook never ran (it crashed, say) is put back', async () => {
    const { app, after } = await planWrite(false);
    expect(after).toEqual({ kind: 'deny', reason: 'plan/plan.json was changed outside the rules and has been put back' });
    expect(app.read(PLAN)).not.toContain('"zod"');
    expect(logText(app)).toMatch(/halt/i);
  });

  test('a write allowed for one file does not cover another changed at the same time', async () => {
    const app = await makeApp({ phase: 'plan2', snapshot: true });
    const edited = longerPlan(app);
    const input = { ...write(app, PLAN, edited, asMain()), tool_use_id: 't-2' };
    await decideFor(app, input);
    app.writeRaw(PLAN, edited);
    app.writeRaw('.seam/env.json', '{}');
    const after = await decideFor(app, { ...input, hook_event_name: 'PostToolUse' });
    expect(after).toEqual({ kind: 'deny', reason: '.seam/env.json was changed outside the rules and has been put back' });
  });

  test('a new test file the main AI writes in the tests phase is kept, also by the next full check', async () => {
    const app = await makeApp({ phase: 'tests', snapshot: true });
    const input = { ...write(app, 'tests/total.test.ts', 'test("x", () => {});\n', asMain()), tool_use_id: 't-3' };
    expect(await decideFor(app, input)).toEqual({ kind: 'allow' });
    app.writeRaw('tests/total.test.ts', 'test("x", () => {});\n');
    expect(await decideFor(app, { ...input, hook_event_name: 'PostToolUse' })).toEqual({ kind: 'allow' });
    expect(await decideFor(app, post('Bash', { command: 'git status' }))).toEqual({ kind: 'allow' });
    expect(app.read('tests/total.test.ts')).toContain('test("x"');
    expect(recordOf(app).files['tests/total.test.ts']).toBeDefined();
  });

  test('a new file in a protected place that the guard did not allow is still moved aside after a file tool', async () => {
    const app = await makeApp({ phase: 'tests', snapshot: true });
    app.writeRaw('tests/sneaky.test.ts', 'x\n');
    expect(await decideFor(app, post('Bash', { command: 'x' }))).toMatchObject({ kind: 'deny', reason: expect.stringContaining('tests/sneaky.test.ts') });
  });
});
