// decideWrite, the role table, part 2 (rules 3 and 6 and R19): what the main AI may write, phase by
// phase. Each case asks the decision directly. The cheats (test/cheats) run the real hook.
import { beforeAll, describe, expect, test } from 'vitest';
import { PHASES } from '../../src/types.ts';
import type { Phase } from '../../src/types.ts';
import { asBuilder, asMain } from '../helpers/app.ts';
import { PLAN_TEXT, TOTAL, total } from '../helpers/code.ts';
import { ask, edits, inPhase, isAllowed, reasonOf, scene, writes } from '../helpers/decide.ts';
import type { Scene } from '../helpers/decide.ts';

let s: Scene;
beforeAll(async () => {
  s = await scene({ files: { '.gitignore': 'scratch/\n', 'contracts/order.ts': 'export const Order = z.object({ id: z.string() });\n' } });
});

/** The main AI writes `rel` in `phase`. */
const mainWrites = (rel: string, phase: Phase, content = 'x\n') => writes(s, rel, content, asMain(), inPhase(s, phase));
const phasesOtherThan = (allowed: readonly Phase[]): Phase[] => PHASES.filter((p) => !allowed.includes(p));

const SCHEMA = 'export const Order = z.object({ id: z.string() })\n';
const WITH_CODE = 'export const Id = z.string().refine((v) => v.length > 2);\n';

describe('rule 3: the plan, in the planning phases only', () => {
  const PLANNING: Phase[] = ['setup', 'survey', 'plan1', 'plan2'];
  test.each(PLANNING)('allowed in %s', async (phase) => {
    await isAllowed(mainWrites('plan/plan.json', phase, PLAN_TEXT));
    await isAllowed(mainWrites('plan/FEATURES.md', phase));
  });
  test.each(phasesOtherThan(PLANNING))('frozen in %s, and the reason says so', async (phase) => {
    expect(await reasonOf(mainWrites('plan/plan.json', phase))).toMatch(/frozen/i);
  });
});

describe('rule 3: contracts, in plan2 only, and only schemas and types', () => {
  test('a schema-only contract is allowed in plan2 (the allow control)', async () => {
    await isAllowed(mainWrites('contracts/order.ts', 'plan2', SCHEMA));
  });
  test('a contract written as an Edit of the file on disk is checked as the whole file', async () => {
    const plan2 = inPhase(s, 'plan2');
    await isAllowed(edits(s, 'contracts/order.ts', 'id: z.string()', 'id: z.string(), qty: z.number()', asMain(), plan2));
    const bad = edits(s, 'contracts/order.ts', 'z.string() }', 'z.string().refine((v) => v.length > 2) }', asMain(), plan2);
    expect(await reasonOf(bad)).toMatch(/contracts may not contain code \(found a function in \.refine\)/);
  });
  test('code in a contract is refused, naming the file and the call', async () => {
    expect(await reasonOf(mainWrites('contracts/order.ts', 'plan2', WITH_CODE))).toMatch(/contracts\/order\.ts.*contracts may not contain code \(found a function in \.refine\)/);
  });
  test('a contract that does not parse is refused', async () => {
    expect(await reasonOf(mainWrites('contracts/order.ts', 'plan2', 'export const = ;\n'))).toMatch(/doesn't parse/);
  });
  test.each(['contracts/order.json', 'contracts/order.sql', 'contracts/README.md', 'contracts/order.tsx', 'contracts/order.js', 'contracts/order.ts.json', 'contracts/order'])(
    'R49: only .ts files: %s is refused even in plan2', async (rel) => {
      expect(await reasonOf(mainWrites(rel, 'plan2', '{}\n'))).toBe('contracts hold TypeScript schemas only');
    });
  test('R49: a .d.ts or an upper-case .TS is a .ts file', async () => {
    await isAllowed(mainWrites('contracts/order.d.ts', 'plan2', 'export type Id = string;\n'));
    await isAllowed(mainWrites('contracts/Order.TS', 'plan2', SCHEMA));
  });
  test('R49: outside plan2 the phase is the reason, whatever the extension', async () => {
    expect(await reasonOf(mainWrites('contracts/order.json', 'build', '{}\n'))).toMatch(/frozen/);
  });
  test.each(phasesOtherThan(['plan2']))('refused in %s, schema or not', async (phase) => {
    expect(await reasonOf(mainWrites('contracts/order.ts', phase, SCHEMA))).toMatch(/contracts.*(?:plan2|second planning)/i);
  });
});

describe('rule 3: tests, in the tests phase only', () => {
  test('allowed in tests', async () => await isAllowed(mainWrites('tests/total.test.ts', 'tests', "it('adds', () => {});\n")));
  test.each(phasesOtherThan(['tests']))('frozen in %s', async (phase) => {
    expect(await reasonOf(mainWrites('tests/total.test.ts', phase))).toMatch(/frozen/i);
  });
});

describe('rule 3: app code is for builders, in every phase', () => {
  test.each(PHASES)('a planned file in %s', async (phase) => {
    expect(await reasonOf(mainWrites(TOTAL, phase, total()))).toMatch(/only builders write app code; the main AI plans and coordinates/);
  });
  test('an Edit is refused the same way', async () => {
    expect(await reasonOf(edits(s, TOTAL, 'Not built yet', 'x', asMain()))).toMatch(/only builders write app code/);
  });
  test('a script in a git-ignored folder is not code, so it is the main AI to write', async () => {
    await isAllowed(mainWrites('scratch/try.ts', 'build', 'export const a = 1;\n'));
  });
});

describe('rule 3: other files (docs, notes) are allowed in every phase', () => {
  test.each(PHASES)('notes.md in %s', async (phase) => {
    await isAllowed(mainWrites('notes.md', phase));
    await isAllowed(mainWrites('docs/guide.md', phase));
    await isAllowed(mainWrites('scratch/log.txt', phase));
  });
});

describe('rule 6: a code file that is not in the plan is refused, whoever writes it', () => {
  test.each(['lib/stash.ts', 'src/helpers.js', 'seed.sql', 'data/rows.json'])('the main AI writing %s', async (rel) => {
    expect(await reasonOf(mainWrites(rel, 'skeleton'))).toMatch(/not in the plan/);
  });
  test('the reason names the file', async () => {
    expect(await reasonOf(mainWrites('lib/stash.ts', 'build'))).toMatch(/^lib\/stash\.ts isn't in the plan/);
  });
  test('a planned file is not "not in the plan": the answer is the role\'s', async () => {
    expect(await reasonOf(mainWrites('src/greeting/Greeting.tsx', 'skeleton'))).not.toMatch(/not in the plan/);
  });
});

describe('R19: node_modules and build output are refused, other ignored folders are not', () => {
  test.each(['node_modules/pkg/index.js', 'node_modules/notes.txt', 'src/node_modules/x.json', 'dist/out.js', '.next/server.js', 'coverage/report.html'])('%s', async (rel) => {
    expect(await reasonOf(mainWrites(rel, 'build'))).toMatch(/node_modules and build output can't be written to/);
  });
  test('a builder is refused there too', async () => {
    const turn = { file: 'node_modules/pkg/index.js', agentId: 'builder-1' };
    expect(await reasonOf(writes(s, 'node_modules/pkg/index.js', 'x', asBuilder('builder-1'), inPhase(s, 'build', turn)))).toMatch(/build output/);
  });
  test('a git-ignored folder follows the normal rules for non-code files', async () => {
    await isAllowed(mainWrites('scratch/notes.txt', 'build'));
    await reasonOf(ask(s, 'Write', { file_path: s.app.abs('scratch/notes.txt'), content: 'x' }, asBuilder('builder-1')));
  });
});
