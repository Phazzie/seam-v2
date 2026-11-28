// The review round on decideWrite. R50: plan/ holds notes and plan.json only, so no code can sit there.
// R53: a path with a hidden-stream colon is refused (in the real hook); the turn match needs a text agent id;
// a missing plan.json refuses every write once the project is past the early phases.
import { rmSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { PHASES } from '../../src/types.ts';
import type { HookInput } from '../../src/types.ts';
import { streamPathProblem } from '../../src/lib/pathcheck.ts';
import { asBuilder, asChecker, asMain, makeApp } from '../helpers/app.ts';
import { expectAllowed, expectDenied, pre, write } from '../helpers/calls.ts';
import { PLAN_TEXT, TOTAL, total } from '../helpers/code.ts';
import { ask, asInput, inPhase, isAllowed, reasonOf, scene, theBuilder, writes } from '../helpers/decide.ts';
import type { Scene } from '../helpers/decide.ts';
import { blocksOf, call, reasonOf as hookReason } from '../helpers/inproc.ts';
import { tempDir } from '../helpers/project.ts';
import { decideWrite } from '../../src/guard/write.ts';

const WIN = process.platform === 'win32';
let s: Scene;
beforeAll(async () => {
  s = await scene();
});

describe('R50: under plan/ the main AI writes notes (.md) and json only', () => {
  const PLANNING = ['setup', 'survey', 'plan1', 'plan2'] as const;
  const HOLDS = 'plan/ holds notes (.md) and plan.json only';
  const mainWrites = (rel: string, phase: (typeof PHASES)[number]) => writes(s, rel, rel === 'plan/plan.json' ? PLAN_TEXT : 'x\n', asMain(), inPhase(s, phase));

  test.each(['plan/evil.ts', 'plan/evil.mjs', 'plan/evil.sh', 'plan/evil.sql', 'plan/evil.js', 'plan/evil.cjs', 'plan/evil.tsx', 'plan/evil.mts', 'plan/evil.ps1', 'plan/evil.bat',
    'plan/evil', 'plan/Makefile', 'plan/sub/evil.ts', 'plan/evil.md.ts', 'plan/evil.json.sh', 'plan/.hidden'])('%s is refused in every planning phase', async (rel) => {
    for (const phase of PLANNING) expect(await reasonOf(mainWrites(rel, phase))).toBe(HOLDS);
  });

  test.each(['plan/plan.json', 'plan/FEATURES.md', 'plan/inventory.md', 'plan/sub/notes.md', 'plan/extra.json', 'plan/NOTES.MD'])('%s is allowed in every planning phase', async (rel) => {
    for (const phase of PLANNING) await isAllowed(mainWrites(rel, phase));
  });

  test('after the plan is frozen the phase is the reason, whatever the extension', async () => {
    for (const phase of PHASES.filter((p) => !PLANNING.includes(p as never))) {
      expect(await reasonOf(mainWrites('plan/evil.ts', phase))).toMatch(/frozen/);
      expect(await reasonOf(mainWrites('plan/FEATURES.md', phase))).toMatch(/frozen/);
    }
  });

  test.runIf(WIN)('a trailing dot or the default stream does not hide the extension', async () => {
    expect(await reasonOf(mainWrites('plan/evil.ts.', 'plan1'))).toBe(HOLDS);
    expect(await reasonOf(mainWrites('plan/evil.ts::$DATA', 'plan1'))).toBe(HOLDS);
  });

  test('an Edit of plan/evil.ts is refused the same way', async () => {
    const edit = ask(s, 'Edit', { file_path: s.app.abs('plan/evil.ts'), old_string: 'a', new_string: 'b' }, asMain(), inPhase(s, 'plan1'));
    expect(await reasonOf(edit)).toBe(HOLDS);
  });

  test('the other roles never get that far', async () => {
    expect(await reasonOf(writes(s, 'plan/evil.ts', 'x', theBuilder(), inPhase(s, 'plan1')))).toMatch(/only during the build phase/);
    expect(await reasonOf(writes(s, 'plan/FEATURES.md', 'x', asChecker(), inPhase(s, 'plan1')))).toMatch(/verdict/);
  });

  test('through the real hook: code under plan/ is refused, notes are not', async () => {
    const app = await makeApp({ phase: 'plan1' });
    for (const rel of ['plan/evil.ts', 'plan/evil.mjs', 'plan/evil.sh', 'plan/evil.sql', 'plan/evil']) {
      expectDenied(await app.hook(write(app, rel, 'x\n')), /^plan\/ holds notes \(\.md\) and plan\.json only$/);
    }
    expectAllowed(await app.hook(write(app, 'plan/FEATURES.md', 'x\n')));
    expectAllowed(await app.hook(write(app, 'plan/plan.json', PLAN_TEXT)));
  });
});

describe('R53: the turn match needs an agent id that is text', () => {
  const nobody = { file: TOTAL, agentId: null };
  const asNull = (): HookInput => ({ ...asInput({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: s.app.abs(TOTAL), content: total() }, agent_type: 'seam-v2:builder' }, s.app), agent_id: null as unknown as string });

  test('a builder with agent_id null does not match a turn that has no agent id', async () => {
    const d = await decideWrite(asNull(), inPhase(s, 'build', nobody));
    expect(d).toEqual({ kind: 'deny', reason: "it isn't this builder's turn for src/pricing/total.ts" });
  });
  test('nor does one with no agent_id at all', async () => {
    expect(await reasonOf(writes(s, TOTAL, total(), { agent_type: 'seam-v2:builder' }, inPhase(s, 'build', nobody)))).toMatch(/isn't this builder's turn/);
  });
  test('nor does one with an agent_id that is not text', async () => {
    const d = await decideWrite({ ...asNull(), agent_id: 7 as unknown as string }, inPhase(s, 'build', { file: TOTAL, agentId: '7' }));
    expect(d.kind).toBe('deny');
  });
  test('the real builder still matches', async () => {
    await isAllowed(writes(s, TOTAL, total(), theBuilder()));
  });
});

describe('R53: a missing plan.json refuses every write past the early phases', () => {
  const noPlan = (phase: (typeof PHASES)[number]) => ({ ...inPhase(s, phase), plan: null });
  const MISSING = /^plan\/plan\.json is missing, so the guard can't tell which files are protected; ask the owner$/;

  test.each(['setup', 'survey', 'plan1'] as const)('in %s the rules still apply, without the lists', async (phase) => {
    await isAllowed(writes(s, 'notes.md', 'x\n', asMain(), noPlan(phase)));
    expect(await reasonOf(writes(s, '.seam/state.json', 'x', asMain(), noPlan(phase)))).toMatch(/records/);
  });

  test.each(PHASES.filter((p) => !['setup', 'survey', 'plan1'].includes(p)))('in %s everything is refused: %s', async (phase) => {
    const ctx = noPlan(phase);
    expect(await reasonOf(writes(s, 'notes.md', 'x\n', asMain(), ctx))).toMatch(MISSING);
    expect(await reasonOf(writes(s, 'plan/plan.json', '{}', asMain(), ctx))).toMatch(MISSING);
    expect(await reasonOf(writes(s, TOTAL, total(), theBuilder(), ctx))).toMatch(MISSING);
    expect(await reasonOf(writes(s, '.seam/verdicts/total.json', '{}', asChecker(), ctx))).toMatch(MISSING);
    expect(await reasonOf(ask(s, 'Write', { file_path: `${s.app.root}/../elsewhere.txt`, content: 'x' }, asMain(), ctx))).toMatch(MISSING);
  });

  test('the words are a rule, not the guard failing', async () => {
    expect(await reasonOf(writes(s, 'notes.md', 'x', asMain(), noPlan('build')))).not.toMatch(/blocked to be safe/);
  });

  test('through the real hook: plan.json deleted in the build phase, a note is refused; in setup it is not', async () => {
    const build = await makeApp({ phase: 'build' });
    rmSync(build.abs('plan/plan.json'));
    expectDenied(await build.hook(write(build, 'notes.md', 'x\n')), MISSING);
    const setup = await makeApp({ phase: 'setup' });
    rmSync(setup.abs('plan/plan.json'));
    expectAllowed(await setup.hook(write(setup, 'notes.md', 'x\n')));
  });
});

describe.runIf(WIN)('R53: a hidden-stream colon in any path field is refused in a seam project', () => {
  const STREAMS = (root: string): string[] => [
    `${root}\\src\\pricing\\total.ts:evil`, `${root}\\data.json:y`, `${root}\\src\\pricing\\total.ts::$DATA`, `${root}\\notes.md:stream:$DATA`,
    'src/pricing/total.ts:evil', 'notes.md:x', `\\\\?\\${root}\\notes.md:x`,
  ];

  test('the reason is plain, and the call is counted', async () => {
    const app = await makeApp({ phase: 'build', lock: true, snapshot: false, turn: { file: TOTAL, agentId: 'builder-1' } });
    for (const [i, file_path] of STREAMS(app.root).entries()) {
      const out = await call(app, pre('Write', { file_path, content: total() }, asBuilder('builder-1')));
      expect(hookReason(out), file_path).toMatch(/colon after the drive letter.*hidden stream/);
      expect(hookReason(out)).not.toMatch(/blocked to be safe/);
      expect(blocksOf(app)).toBe(i + 1);
    }
  });

  test('it holds for every path field and every tool, through the real hook', async () => {
    const app = await makeApp({ phase: 'build' });
    const bad = `${app.root}\\notes.md:x`;
    for (const toolInput of [{ file_path: bad, content: 'x' }, { notebook_path: bad }, { path: bad, pattern: '*' }, { file_path: bad }]) {
      for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Read', 'Grep']) {
        expectDenied(await app.hook(pre(tool, toolInput)), /hidden stream/);
      }
    }
  });

  test('the same name without the colon is fine, and so is a colon in a command or in content', async () => {
    const app = await makeApp({ phase: 'build' });
    expectAllowed(await app.hook(write(app, 'notes.md', 'time: 12:30\n')));
    expectAllowed(await app.hook(pre('Write', { file_path: `${app.root}\\notes.md`, content: 'x' })));
  });

  test('in a folder that is not a seam project the guard says nothing', async () => {
    const app = await makeApp({ phase: 'build' });
    const elsewhere = tempDir();
    expectAllowed(await app.hook(pre('Write', { file_path: `${elsewhere}\\x.md:y`, content: 'x' }), { cwd: elsewhere }));
  });

  test.each([
    ['C:\\proj\\a.ts', null], ['C:/proj/a.ts', null], ['a.ts', null], ['C:a.ts', null], ['\\\\?\\C:\\proj\\a.ts', null], ['\\\\host\\share\\a.ts', null],
    ['a.ts:evil', 'colon'], ['C:\\proj\\a.ts:evil', 'colon'], ['C:a.ts:evil', 'colon'], ['\\\\?\\C:\\a.ts:evil', 'colon'], ['\\\\host\\share\\a.ts:evil', 'colon'], ['a:b:c', 'colon'],
  ])('streamPathProblem(%s)', (path, found) => {
    expect(streamPathProblem(path) === null ? null : 'colon').toBe(found);
  });
});
