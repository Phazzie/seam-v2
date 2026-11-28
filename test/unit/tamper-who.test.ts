// What the tamper check does about who changed a protected file: a strike for a builder, a halt for the
// main AI, "unattributed" when other calls were running too, and a legitimate builder change accepted.
import { describe, expect, test } from 'vitest';
import { checkTamper } from '../../src/guard/tamper.ts';
import { asBuilder, asChecker, makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { post } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';
import { ctxOf, logText, longerPlan, problemsOf, recordOf, stateOf } from '../helpers/tamper.ts';

const PLAN = 'plan/plan.json';
const bash = (who = {}, id = 'call-1') => ({ ...post('Bash', { command: 'echo hi' }, who), tool_use_id: id });
const turn = { file: TOTAL, agentId: 'builder-1' };
const writeTotal = (app: App, text: string, who = asBuilder('builder-1')) =>
  ({ ...post('Write', { file_path: app.abs(TOTAL), content: text }, who), tool_use_id: 'w-1' });

describe('the main AI', () => {
  test('changing a protected file halts the run, with the path in the reason', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(PLAN, longerPlan(app));
    await problemsOf(app, bash());
    expect(stateOf(app).halted).toBe('the main AI changed a protected file: plan/plan.json');
    expect(logText(app)).toMatch(/halt/i);
  });

  test('a second tamper keeps the first reason', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(PLAN, longerPlan(app));
    await problemsOf(app, bash());
    app.writeRaw('.seam/lock.json', '{"version":1,"files":{}}');
    await problemsOf(app, bash());
    expect(stateOf(app).halted).toContain('plan/plan.json');
  });
});

describe('a builder', () => {
  test('a body filled in on its own file is accepted, and still there on the next check', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    app.writeRaw(TOTAL, total());
    expect(await problemsOf(app, writeTotal(app, total()))).toEqual([]);
    expect(await problemsOf(app, bash())).toEqual([]);
    expect(app.read(TOTAL)).toBe(total());
    expect(stateOf(app).strikes).toEqual({});
    expect(stateOf(app).halted).toBeNull();
  });

  test('a change that breaks the lock is put back and costs a strike, not a halt', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    const skeleton = app.read(TOTAL);
    app.writeRaw(TOTAL, total({ params: 'a: number, b: number, c: number' }));
    const [problem] = await problemsOf(app, writeTotal(app, ''));
    expect(problem).toMatch(/^src\/pricing\/total\.ts was changed outside the rules and has been put back/);
    expect(app.read(TOTAL)).toBe(skeleton);
    expect(stateOf(app).strikes).toEqual({ [TOTAL]: 1 });
    expect(stateOf(app).halted).toBeNull();
  });

  test('a 3 MB file in place of its file is put back without being parsed', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    const skeleton = app.read(TOTAL);
    app.writeRaw(TOTAL, `${total()}// ${'x'.repeat(3 * 1024 * 1024)}\n`);
    expect((await problemsOf(app, writeTotal(app, '')))[0]).toMatch(/put back/);
    expect(app.read(TOTAL)).toBe(skeleton);
  });

  test('another file changed through a command is a strike on the turn file', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    app.writeRaw(PLAN, longerPlan(app));
    expect(await problemsOf(app, bash(asBuilder('builder-1')))).toEqual(['plan/plan.json was changed outside the rules and has been put back']);
    expect(stateOf(app).strikes).toEqual({ [TOTAL]: 1 });
    expect(stateOf(app).halted).toBeNull();
  });

  test("another builder's change to the turn file is not accepted", async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    const skeleton = app.read(TOTAL);
    app.writeRaw(TOTAL, total());
    expect(await problemsOf(app, writeTotal(app, total(), asBuilder('builder-2')))).toHaveLength(1);
    expect(app.read(TOTAL)).toBe(skeleton);
  });
});

describe('another agent', () => {
  test('a checker that changes a protected file halts the run', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(PLAN, longerPlan(app));
    await problemsOf(app, bash(asChecker()));
    expect(stateOf(app).halted).toBe('the checker agent changed a protected file: plan/plan.json');
  });
});

describe('parallel calls (R16)', () => {
  /** Another call has started and not finished: its hook run left a note in .seam/inflight. */
  async function withOtherCallRunning(): Promise<App> {
    const app = await makeApp({ phase: 'build', lock: true });
    const { started } = await import('../../src/guard/inflight.ts');
    started(ctxOf(app), { cwd: app.root, ...bash({}, 'other') }, []);
    return app;
  }

  test('a change found while another call is running is put back and logged unattributed, with no halt', async () => {
    const app = await withOtherCallRunning();
    const original = app.read(PLAN);
    app.writeRaw(PLAN, longerPlan(app));
    expect(await problemsOf(app, bash())).toEqual(['plan/plan.json was changed outside the rules and has been put back']);
    expect(app.read(PLAN)).toBe(original);
    expect(stateOf(app).halted).toBeNull();
    expect(stateOf(app).strikes).toEqual({});
    expect(logText(app)).toMatch(/unattributed/i);
    expect(recordOf(app).unattributed).toBe(1);
  });

  test('three in a row halt the run; a change that can be tied to one call starts the count again', async () => {
    const app = await withOtherCallRunning();
    for (let i = 0; i < 2; i += 1) {
      app.writeRaw(PLAN, longerPlan(app));
      await problemsOf(app, bash());
    }
    expect(stateOf(app).halted).toBeNull();
    const { finished } = await import('../../src/guard/inflight.ts');
    finished(ctxOf(app), { cwd: app.root, ...bash({}, 'other') });
    app.writeRaw(PLAN, longerPlan(app));
    await problemsOf(app, bash({ agent_id: 'x', agent_type: 'seam-v2:builder' }));
    expect(recordOf(app).unattributed).toBe(0);
  });

  test('the third unattributed change in a row halts the run', async () => {
    const app = await withOtherCallRunning();
    for (let i = 0; i < 3; i += 1) {
      app.writeRaw(PLAN, longerPlan(app));
      await problemsOf(app, bash());
    }
    expect(stateOf(app).halted).toMatch(/could not tell who.*plan\/plan\.json/);
  });

  test('a call that never finished (older than ten minutes) does not count as running', async () => {
    const app = await withOtherCallRunning();
    const old = new Date(Date.now() + 11 * 60 * 1000);
    app.writeRaw(PLAN, longerPlan(app));
    await checkTamper({ cwd: app.root, ...bash() }, { ...ctxOf(app), now: old });
    expect(stateOf(app).halted).toMatch(/main AI/);
  });
});
