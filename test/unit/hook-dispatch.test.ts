// How the hook routes a call to a decision, hands it the context, and turns the answer into output
// (with the decisions replaced by spies).
import { rmSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { decideCommand } from '../../src/guard/command.ts';
import { decideRead } from '../../src/guard/read.ts';
import { checkTamper } from '../../src/guard/tamper.ts';
import { decideWrite } from '../../src/guard/write.ts';
import { resolveReal } from '../../src/lib/paths.ts';
import type { Decision } from '../../src/types.ts';
import { asBuilder, makeApp } from '../helpers/app.ts';
import { post, pre, write } from '../helpers/calls.ts';
import { blocksOf, call, logOf, printed, reasonOf } from '../helpers/inproc.ts';

vi.mock('../../src/guard/write.ts', () => ({ decideWrite: vi.fn() }));
vi.mock('../../src/guard/command.ts', () => ({ decideCommand: vi.fn() }));
vi.mock('../../src/guard/read.ts', () => ({ decideRead: vi.fn() }));
vi.mock('../../src/guard/tamper.ts', () => ({ checkTamper: vi.fn(), snapshotProtected: vi.fn() }));

const ALLOW: Decision = { kind: 'allow' };
const SILENT = { stdout: '', exitCode: 0 };
const deciders = [decideWrite, decideCommand, decideRead];

beforeEach(() => {
  for (const fn of deciders) vi.mocked(fn).mockReset().mockReturnValue(ALLOW);
  vi.mocked(checkTamper).mockReset().mockReturnValue({ problems: [] });
});

const decisionsAsked = (): number => deciders.reduce((n, fn) => n + vi.mocked(fn).mock.calls.length, 0);

describe('Before a tool runs: which decision gets the call', () => {
  test.each([
    ['Write', decideWrite], ['Edit', decideWrite], ['MultiEdit', decideWrite], ['NotebookEdit', decideWrite],
    ['Bash', decideCommand], ['PowerShell', decideCommand],
    ['Read', decideRead], ['Glob', decideRead], ['Grep', decideRead],
  ])('%s goes to its decision, once, and to no other', async (tool, wanted) => {
    const app = await makeApp({ phase: 'build' });
    expect(await call(app, pre(tool, { command: 'git status' }))).toEqual(SILENT);
    expect(vi.mocked(wanted)).toHaveBeenCalledTimes(1);
    for (const other of deciders.filter((fn) => fn !== wanted)) expect(vi.mocked(other)).not.toHaveBeenCalled();
    expect(vi.mocked(checkTamper)).not.toHaveBeenCalled();
  });

  test.each(['Agent', 'WebFetch', 'ToolSearch', 'TodoWrite', 'mcp__claude_ai_GrabGPU__find_gpu', 'write', 'bash'])(
    '%s is not one the guard decides: silent, no decision called',
    async (tool) => {
      const app = await makeApp({ phase: 'build' });
      expect(await call(app, pre(tool, { prompt: 'x' }))).toEqual(SILENT);
      expect(decisionsAsked()).toBe(0);
    },
  );

  test('the decision gets the request as it came, and the context of the project', async () => {
    const app = await makeApp({ phase: 'build' });
    const before = Date.now();
    const input = write(app, 'src/a.ts', 'x', asBuilder('agent-7'));
    await call(app, input);
    const [seen, ctx] = vi.mocked(decideWrite).mock.calls[0];
    expect(seen).toMatchObject({ hook_event_name: 'PreToolUse', tool_name: 'Write', agent_id: 'agent-7', agent_type: 'seam-v2:builder', tool_input: input.tool_input });
    expect(ctx.root).toBe(resolveReal(app.root, '.'));
    expect(ctx).toMatchObject({ dataDir: app.dataDir, pluginRoot: app.pluginRoot, lock: null });
    expect(ctx.state.phase).toBe('build');
    expect(ctx.plan?.seams.length).toBeGreaterThan(0);
    expect(resolveReal(ctx.appRoot, '.')).toBe(resolveReal(app.root, ctx.plan?.appRoot ?? '.'));
    expect(ctx.now.getTime()).toBeGreaterThanOrEqual(before);
  });

  test('a project with no plan yet still gets a context (plan and lock are null)', async () => {
    const app = await makeApp({ phase: 'setup' });
    rmSync(app.abs('plan/plan.json'));
    expect(await call(app, pre('Write', { file_path: app.abs('notes.md'), content: 'x' }))).toEqual(SILENT);
    const ctx = vi.mocked(decideWrite).mock.calls[0][1];
    expect(ctx).toMatchObject({ plan: null, lock: null });
    expect(resolveReal(ctx.appRoot, '.')).toBe(resolveReal(app.root, '.'));
  });

  test('a plan or lock that is there but invalid is a refusal before any decision, not an allow', async () => {
    const app = await makeApp({ phase: 'build' });
    app.writeRaw('.seam/lock.json', '{ "version": 2 }');
    expect(reasonOf(await call(app, write(app, 'notes.md', 'x')))).toMatch(/^seam guard hit an internal error and blocked to be safe: .*lock.json/);
    expect(decisionsAsked()).toBe(0);
  });
});

describe('what a refusal from a decision turns into', () => {
  test('a deny is printed as the deny, with the decision\'s own reason, counted and logged', async () => {
    const app = await makeApp({ phase: 'build' });
    vi.mocked(decideWrite).mockReturnValue({ kind: 'deny', reason: 'only builders write app code' });
    const out = await call(app, write(app, 'src/a.ts', 'x'));
    expect(printed(out)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'only builders write app code' },
    });
    expect(blocksOf(app)).toBe(1);
    expect(logOf(app.root)).toMatch(/^\d\d:\d\d Blocked: main tried Write on .*src[\\/]a\.ts: only builders write app code\n$/);
  });

  test('the log says who: a builder, a checker', async () => {
    const app = await makeApp({ phase: 'build' });
    vi.mocked(decideWrite).mockReturnValue({ kind: 'deny', reason: 'no' });
    await call(app, write(app, 'a.ts', 'x', asBuilder('b-1')));
    expect(logOf(app.root)).toMatch(/Blocked: builder tried Write/);
  });

  test('a command is named by its first 80 characters, on one line', async () => {
    const app = await makeApp({ phase: 'build' });
    vi.mocked(decideCommand).mockReturnValue({ kind: 'deny', reason: 'nope' });
    await call(app, pre('Bash', { command: `echo ${'x'.repeat(100)}\nrm -rf everything` }));
    const log = logOf(app.root);
    expect(log.trimEnd().split('\n')).toHaveLength(1);
    expect(log).toContain(`tried Bash "echo ${'x'.repeat(75)}": nope`);
  });

  test('a decision that throws or rejects is a refusal that says so, counted', async () => {
    const app = await makeApp({ phase: 'build' });
    vi.mocked(decideRead).mockImplementation(() => {
      throw new Error('the lock file is broken');
    });
    expect(reasonOf(await call(app, pre('Read', { file_path: app.abs('a.ts') })))).toBe(
      'seam guard hit an internal error and blocked to be safe: the lock file is broken',
    );
    expect(blocksOf(app)).toBe(1);
  });

  test('a bad value from a decision (nothing at all) is a refusal too, never an allow', async () => {
    const app = await makeApp({ phase: 'build' });
    vi.mocked(decideRead).mockReturnValue(undefined as unknown as Decision);
    const out = await call(app, pre('Read', { file_path: app.abs('a.ts') }));
    expect(reasonOf(out)).toMatch(/blocked to be safe/);
  });
});

describe('After a tool ran: the tamper check', () => {
  test.each(['Write', 'Edit', 'Bash', 'PowerShell', 'Read', 'Agent', 'mcp__x__y'])('%s is checked, and no decision is asked', async (tool) => {
    const app = await makeApp({ phase: 'build' });
    expect(await call(app, post(tool, { command: 'ls' }))).toEqual(SILENT);
    expect(vi.mocked(checkTamper)).toHaveBeenCalledTimes(1);
    expect(decisionsAsked()).toBe(0);
  });

  test('problems come back as one block, joined, counted, and logged', async () => {
    const app = await makeApp({ phase: 'build' });
    vi.mocked(checkTamper).mockReturnValue({ problems: ['plan/plan.json was changed and has been put back', 'lib/stash.ts was moved away'] });
    const out = await call(app, post('Bash', { command: 'ls' }));
    expect(printed(out)).toEqual({ decision: 'block', reason: 'plan/plan.json was changed and has been put back; lib/stash.ts was moved away' });
    expect(blocksOf(app)).toBe(1);
    expect(logOf(app.root)).toMatch(/Blocked: main Bash "ls" left a problem: plan\/plan\.json was changed/);
  });

  test('the tamper check gets the request and the context', async () => {
    const app = await makeApp({ phase: 'build' });
    await call(app, post('Write', { file_path: app.abs('a.ts') }, asBuilder('b-1')));
    const [seen, ctx] = vi.mocked(checkTamper).mock.calls[0];
    expect(seen).toMatchObject({ hook_event_name: 'PostToolUse', tool_name: 'Write', agent_id: 'b-1' });
    expect(ctx.state.phase).toBe('build');
  });

  test('a tamper check that throws is a block that says so', async () => {
    const app = await makeApp({ phase: 'build' });
    vi.mocked(checkTamper).mockImplementation(() => {
      throw new Error('could not read the snapshot');
    });
    expect(printed(await call(app, post('Bash', { command: 'ls' })))).toEqual({
      decision: 'block', reason: 'seam guard hit an internal error and blocked to be safe: could not read the snapshot',
    });
  });

  test('before a tool runs, the tamper check is not asked', async () => {
    const app = await makeApp({ phase: 'build' });
    await call(app, pre('Bash', { command: 'ls' }));
    expect(vi.mocked(checkTamper)).not.toHaveBeenCalled();
  });
});
