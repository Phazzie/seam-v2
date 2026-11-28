// R73 on decideWrite: node_modules and build output are refused inside a protected folder too (Codex on PR #21, P1),
// a config file's name wins inside tests/ (P2), and plan/plan.json is validated before it is written, so an honest
// planner's typo is a refusal that says what to fix instead of a plan the guard cannot read.
import { beforeAll, describe, expect, test } from 'vitest';
import type { Phase } from '../../src/types.ts';
import { asBuilder, asMain, makeApp } from '../helpers/app.ts';
import { expectAllowed, expectDenied, write } from '../helpers/calls.ts';
import { PLAN_TEXT } from '../helpers/code.ts';
import { ask, edits, inPhase, isAllowed, reasonOf, scene, writes } from '../helpers/decide.ts';
import type { Scene } from '../helpers/decide.ts';
import { project } from '../helpers/project.ts';

let s: Scene;
beforeAll(async () => {
  s = await scene();
});

const mainWrites = (rel: string, phase: Phase, content = 'x\n') => writes(s, rel, content, asMain(), inPhase(s, phase));

describe('P1: node_modules and build output, even inside a place the main AI may write', () => {
  const OUTPUT = /node_modules and build output can't be written to/;

  test.each([
    ['tests/node_modules/pkg/index.js', 'tests'], ['test/node_modules/x.ts', 'tests'], ['tests/real/node_modules/x.json', 'tests'],
    ['contracts/node_modules/x/index.ts', 'plan2'], ['plan/node_modules/x.md', 'plan1'],
  ] as const)('the main AI cannot write %s in %s', async (rel, phase) => {
    expect(await reasonOf(mainWrites(rel, phase))).toMatch(OUTPUT);
  });

  test('a builder cannot either, even when the file is named as its turn', async () => {
    const turn = { file: 'tests/node_modules/pkg/index.js', agentId: 'builder-1' };
    expect(await reasonOf(writes(s, 'tests/node_modules/pkg/index.js', 'x', asBuilder('builder-1'), inPhase(s, 'build', turn)))).toMatch(OUTPUT);
  });

  test('the controls: a real test file in the tests phase and a note in plan1 are still allowed', async () => {
    await isAllowed(mainWrites('tests/total.test.ts', 'tests'));
    await isAllowed(mainWrites('plan/FEATURES.md', 'plan1'));
  });
});

describe('P2: a config file name is a config file inside tests/ (and the other frozen folders)', () => {
  const CONFIG = /config files are frozen/;

  test.each([
    'tests/package.json', 'tests/package-lock.json', 'tests/tsconfig.json', 'tests/tsconfig.build.json', 'tests/vitest.config.ts', 'tests/vitest.config.mjs',
    'tests/sub/vitest.config.ts', 'tests/.env', 'tests/.env.local', 'tests/.npmrc', 'tests/.babelrc', 'tests/.github/workflows/ci.yml', 'test/package.json',
  ])('the main AI cannot write %s in the tests phase', async (rel) => {
    expect(await reasonOf(mainWrites(rel, 'tests'))).toMatch(CONFIG);
  });

  test('so is contracts/package.json in plan2, whatever its extension would allow', async () => {
    expect(await reasonOf(mainWrites('contracts/package.json', 'plan2'))).toMatch(CONFIG);
  });

  test('classify says config-file for them, and still tests for the rest of the folder', () => {
    const p = project();
    expect(['tests/package.json', 'tests/.env', 'tests/vitest.config.ts', 'contracts/tsconfig.json', 'fixtures/.env'].map((rel) => p.at(rel))).toEqual(Array(5).fill('config-file'));
    expect(['tests/total.test.ts', 'tests/helpers/make.ts', 'tests/README.md'].map((rel) => p.at(rel))).toEqual(Array(3).fill('tests'));
    expect(p.at('contracts/order.ts')).toBe('contracts');
  });
});

describe('plan/plan.json is validated before the main AI writes it (it must be a plan the guard can read)', () => {
  const planWith = (change: (plan: Record<string, unknown>) => void): string => {
    const plan = JSON.parse(PLAN_TEXT) as Record<string, unknown>;
    change(plan);
    return `${JSON.stringify(plan, null, 2)}\n`;
  };
  const seam = (plan: Record<string, unknown>) => (plan.seams as { files: { steps: string[]; estLines: unknown }[] }[])[0].files[0];

  test('a step list that is too short is refused, with the first problem and where it is', async () => {
    const text = planWith((plan) => void (seam(plan).steps = ['only one']));
    expect(await reasonOf(mainWrites('plan/plan.json', 'plan1', text))).toBe(
      "plan/plan.json isn't valid yet: seams[0].files[0].steps: needs at least 3 steps, each one specific and checkable; write the whole plan in one Write, or make an edit that leaves it valid",
    );
  });

  test.each(['not JSON at all', '', '{"version": 1'])('R74: every plan refusal says how to get a valid plan in: %j', async (text) => {
    expect(await reasonOf(mainWrites('plan/plan.json', 'plan1', text))).toMatch(/; write the whole plan in one Write, or make an edit that leaves it valid$/);
  });

  test.each([
    ['not JSON at all', 'steps: 1, 2, 3', /^plan\/plan\.json isn't valid yet: it is not valid JSON \(/],
    ['a field of the wrong type', planWith((plan) => void (seam(plan).estLines = 'many')), /isn't valid yet: seams\[0\]\.files\[0\]\.estLines: /],
    ['a field it does not know', planWith((plan) => void (plan.typo = true)), /isn't valid yet: /],
    ['a missing field', planWith((plan) => void delete plan.buildOrder), /isn't valid yet: buildOrder: /],
    ['an empty file', '', /isn't valid yet: it is not valid JSON/],
  ])('%s is refused, in every planning phase', async (_name, text, message) => {
    for (const phase of ['setup', 'survey', 'plan1', 'plan2'] as const) expect(await reasonOf(mainWrites('plan/plan.json', phase, text))).toMatch(message);
  });

  test('an Edit is judged by what the file would hold afterwards: one that keeps it valid is allowed, one that breaks it is not', async () => {
    const plan1 = inPhase(s, 'plan1');
    s.app.writeRaw('plan/plan.json', PLAN_TEXT);
    await isAllowed(edits(s, 'plan/plan.json', '"estLines": 25', '"estLines": 26', asMain(), plan1));
    expect(await reasonOf(edits(s, 'plan/plan.json', '"estLines": 25', '"estLines": "lots"', asMain(), plan1))).toMatch(/isn't valid yet: seams\[0\]\.files\[0\]\.estLines/);
    expect(await reasonOf(ask(s, 'Edit', { file_path: s.app.abs('plan/plan.json'), old_string: 'nowhere', new_string: 'x' }, asMain(), plan1))).toMatch(/text to replace wasn't found/);
  });

  test('only plan.json is checked: other json and notes under plan/ are written as before, and a valid plan is allowed', async () => {
    await isAllowed(mainWrites('plan/extra.json', 'plan1', '{}\n'));
    await isAllowed(mainWrites('plan/FEATURES.md', 'plan1'));
    await isAllowed(mainWrites('plan/plan.json', 'plan1', PLAN_TEXT));
  });

  test('through the real hook: a typo is a refusal that names the problem, and the plan on disk is untouched', async () => {
    const app = await makeApp({ phase: 'plan1' });
    const bad = planWith((plan) => void (seam(plan).steps = ['a', 'b']));
    expectDenied(await app.hook(write(app, 'plan/plan.json', bad)), /^plan\/plan\.json isn't valid yet: seams\[0\]\.files\[0\]\.steps: needs at least 3 steps/);
    expect(app.read('plan/plan.json')).toBe(PLAN_TEXT);
    expectAllowed(await app.hook(write(app, 'plan/plan.json', planWith((plan) => void (seam(plan).estLines = 31)))));
  });
});
