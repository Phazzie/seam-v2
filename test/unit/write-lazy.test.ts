// R47: decideWrite loads the modules that use the TypeScript parser (lockcheck.ts, rules.ts) only when it
// has to read code: a builder's write that got as far as its text, and a main-AI contract write that got as
// far as its text. Every decision made by the kind of path, the phase or the turn must not load them. The two
// modules are wrapped so that loading one is noticed; a module is loaded once per test file, so the cases that
// must not load them come first and the ones that must come last.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { asBuilder, asChecker, asMain } from '../helpers/app.ts';
import { TOTAL, total } from '../helpers/code.ts';
import { ask, edits, inPhase, scene, theBuilder, writes } from '../helpers/decide.ts';
import type { Scene } from '../helpers/decide.ts';

const loaded = vi.hoisted(() => [] as string[]);
vi.mock('../../src/lib/lockcheck.ts', async (original) => {
  loaded.push('lockcheck');
  return original();
});
vi.mock('../../src/lib/rules.ts', async (original) => {
  loaded.push('rules');
  return original();
});

let s: Scene;
beforeAll(async () => {
  s = await scene({ files: { 'scratch.log': 'x\n' } });
});

const SCHEMA = 'export const Order = z.object({ id: z.string() })\n';

describe('decisions that never read code do not load the parser', () => {
  test('nothing is loaded by setting the project up', () => {
    expect(loaded).toEqual([]);
  });

  test('main: planning files and docs', async () => {
    for (const phase of ['setup', 'survey', 'plan1', 'plan2'] as const) {
      expect(await writes(s, 'plan/notes.md', 'x\n', asMain(), inPhase(s, phase))).toEqual({ kind: 'allow' });
    }
    expect(await writes(s, 'notes.md', 'x\n', asMain())).toEqual({ kind: 'allow' });
    expect(await writes(s, 'tests/a.test.ts', 'x\n', asMain(), inPhase(s, 'tests'))).toEqual({ kind: 'allow' });
    expect(loaded).toEqual([]);
  });

  test('main: refusals by kind of path, phase or extension', async () => {
    expect((await writes(s, TOTAL, total(), asMain())).kind).toBe('deny');
    expect((await writes(s, 'plan/plan.json', '{}', asMain())).kind).toBe('deny');
    expect((await writes(s, 'tests/a.test.ts', 'x', asMain())).kind).toBe('deny');
    expect((await writes(s, 'contracts/order.ts', SCHEMA, asMain(), inPhase(s, 'build'))).kind).toBe('deny');
    expect((await writes(s, 'contracts/order.json', '{}', asMain(), inPhase(s, 'plan2'))).kind).toBe('deny');
    expect((await writes(s, 'lib/stash.ts', 'x', asMain())).kind).toBe('deny');
    expect((await writes(s, 'node_modules/x/index.js', 'x', asMain())).kind).toBe('deny');
    expect((await writes(s, '.seam/state.json', '{}', asMain())).kind).toBe('deny');
    expect((await writes(s, 'package.json', '{}', asMain())).kind).toBe('deny');
    expect(loaded).toEqual([]);
  });

  test('the other roles', async () => {
    expect((await writes(s, 'notes.md', 'x', asChecker())).kind).toBe('deny');
    expect((await writes(s, 'notes.md', 'x', { agent_id: 'u-1' })).kind).toBe('deny');
    expect(await writes(s, '.seam/verdicts/total.json', '{}', asChecker())).toEqual({ kind: 'allow' });
    expect((await ask(s, 'Write', { file_path: join(tmpdir(), 'outside.txt'), content: 'x' }, asBuilder('builder-1'))).kind).toBe('deny');
    expect(loaded).toEqual([]);
  });

  test('a builder refused by phase, turn, plan or lock, before its text is read', async () => {
    expect((await writes(s, TOTAL, total(), theBuilder(), inPhase(s, 'skeleton'))).kind).toBe('deny');
    expect((await writes(s, TOTAL, total(), asBuilder('builder-2'))).kind).toBe('deny');
    expect((await writes(s, 'src/greeting/Greeting.tsx', 'x', theBuilder())).kind).toBe('deny');
    expect((await writes(s, 'lib/stash.ts', 'x', theBuilder())).kind).toBe('deny');
    expect((await writes(s, TOTAL, total(), theBuilder(), { ...s.ctx, lock: null })).kind).toBe('deny');
    expect((await edits(s, TOTAL, 'this text is nowhere', 'x', theBuilder())).kind).toBe('deny');
    expect(loaded).toEqual([]);
  });
});

describe('decisions that read code load the parser, and only the part they use', () => {
  test('a contract in plan2 loads the rules, not the lock check', async () => {
    expect(await writes(s, 'contracts/order.ts', SCHEMA, asMain(), inPhase(s, 'plan2'))).toEqual({ kind: 'allow' });
    expect(loaded).toEqual(['rules']);
  });

  test("a builder's code write loads the lock check too", async () => {
    expect(await writes(s, TOTAL, total(), theBuilder())).toEqual({ kind: 'allow' });
    expect(loaded).toContain('lockcheck');
  });
});
