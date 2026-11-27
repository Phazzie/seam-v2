import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { formatHeader, parseHeader } from '../../src/formats/header.ts';
import { loadLock, parseLock } from '../../src/formats/lock.ts';
import { loadPlan, parsePlan } from '../../src/formats/plan.ts';
import type { Plan } from '../../src/formats/plan.ts';
import { loadState, parseState } from '../../src/formats/state.ts';

const PRACTICE = resolve(import.meta.dirname, '../fixtures/practice-app');
const PRACTICE_JSON: unknown = JSON.parse(readFileSync(join(PRACTICE, 'plan/plan.json'), 'utf8'));
const PRACTICE_PLAN: Plan = parsePlan(PRACTICE_JSON);

const temps: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'seam-formats-'));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const emptyDir = tempDir();
const dirWith = (rel: string, text: string): string => {
  const dir = tempDir();
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
  return dir;
};

/** The practice plan as plain JSON, with the first file's fields overridden. */
function planWith(overrides: Record<string, unknown>): unknown {
  const raw = structuredClone(PRACTICE_JSON) as { seams: { files: Record<string, unknown>[] }[] };
  Object.assign(raw.seams[0].files[0], overrides);
  return raw;
}

const GOOD_STATE = {
  version: 1, phase: 'build', turn: { agentId: null, file: null, startedAt: null },
  strikes: {}, parked: [], approvals: [], blocks: 0, halted: null,
};

describe('plan format', () => {
  test('plan with 2 steps is rejected in plain English', () => {
    expect(() => parsePlan(planWith({ steps: ['a', 'b'] }))).toThrow(/at least 3 steps/);
  });
  test('valid practice plan loads', () => {
    expect(loadPlan(PRACTICE)?.seams.map((s) => s.id)).toEqual(['pricing', 'greeting']);
  });
  test('missing plan file loads as null', () => {
    expect(loadPlan(emptyDir)).toBeNull();
  });
  test('promise ids must look like P-name-1', () => {
    expect(() => parsePlan(planWith({ promises: [{ id: 'pricing-1', text: 'x' }] }))).toThrow(/P-/);
  });
  test('text that could break out of the header comment is rejected', () => {
    expect(() => parsePlan(planWith({ purpose: 'sneaky */ code' }))).toThrow(/\*\//);
    expect(() => parsePlan(planWith({ steps: ['a\nb', 'c', 'd'] }))).toThrow(/single line/);
  });
  test('an unreadable plan file is named in the error', () => {
    expect(() => loadPlan(dirWith('plan/plan.json', '{oops'))).toThrow(/plan\/plan\.json is unreadable/);
  });
  test('a plan with the wrong shape names the file and the field', () => {
    const bad = dirWith('plan/plan.json', JSON.stringify({ version: 1 }));
    expect(() => loadPlan(bad)).toThrow(/plan\/plan\.json is invalid[\s\S]*appRoot/);
  });
});

describe('header format', () => {
  test('header round-trips', () => {
    const f = PRACTICE_PLAN.seams[0].files[0];
    expect(parseHeader(formatHeader('pricing', f))).toEqual({ seam: 'pricing', steps: f.steps, promises: f.promises });
  });
  test('header has the documented layout', () => {
    const lines = formatHeader('pricing', PRACTICE_PLAN.seams[0].files[0]).split('\n');
    expect(lines.slice(0, 5)).toEqual([
      '/**',
      ' * @seam pricing',
      ' * Purpose: Add two prices together into one total.',
      ' * Inputs: a: number (first price), b: number (second price)',
      ' * Outputs: the combined total as a number',
    ]);
    expect(lines).toContain(' *  2. Add the second price to it');
    expect(lines).toContain(' *  P-pricing-1: total(2, 3) returns 5');
    expect(lines.at(-1)).toBe(' */');
  });
  test('text with no seam header parses as null', () => {
    expect(parseHeader('export const a = 1;\n')).toBeNull();
    expect(parseHeader('/** just a note */\nexport const a = 1;\n')).toBeNull();
  });
  test('a header that is not at the top of the file is not accepted', () => {
    const h = formatHeader('pricing', PRACTICE_PLAN.seams[0].files[0]);
    expect(parseHeader(`export const a = 1;\n${h}\n`)).toBeNull();
  });
  test('Windows line endings and a BOM do not matter', () => {
    const f = PRACTICE_PLAN.seams[0].files[0];
    const text = '\uFEFF' + formatHeader('pricing', f).replace(/\n/g, '\r\n') + '\r\nexport {};\r\n';
    expect(parseHeader(text)).toEqual({ seam: 'pricing', steps: f.steps, promises: f.promises });
  });
});

describe('state format', () => {
  test('missing state file loads as null, corrupt one throws', () => {
    expect(loadState(emptyDir)).toBeNull();
    expect(() => loadState(dirWith('.seam/state.json', '{oops'))).toThrow(/state\.json is unreadable/);
  });
  test('done defaults to an empty list', () => {
    expect(parseState(GOOD_STATE).done).toEqual([]);
  });
  test('a state file with a BOM still loads', () => {
    const dir = dirWith('.seam/state.json', '\uFEFF' + JSON.stringify(GOOD_STATE));
    expect(loadState(dir)?.phase).toBe('build');
  });
  test('an unknown phase is rejected in plain English', () => {
    expect(() => parseState({ ...GOOD_STATE, phase: 'party' })).toThrow(/phase/);
  });
});

describe('lock format', () => {
  const GOOD_LOCK = {
    version: 1,
    files: {
      'src/pricing/total.ts': { kind: 'code', header: 'abc', exports: { total: 'h1' }, steps: { total: ['Step 1: a'] }, plannedImports: [] },
      'plan/plan.json': { kind: 'whole', hash: 'def' },
    },
  };
  test('missing lock loads as null, good one loads, bad one throws', () => {
    expect(loadLock(emptyDir)).toBeNull();
    const lock = loadLock(dirWith('.seam/lock.json', JSON.stringify(GOOD_LOCK)));
    expect(lock?.files['plan/plan.json']).toEqual({ kind: 'whole', hash: 'def' });
    expect(() => loadLock(dirWith('.seam/lock.json', 'nope'))).toThrow(/lock\.json is unreadable/);
  });
  test('a lock entry of an unknown kind is rejected', () => {
    expect(() => parseLock({ version: 1, files: { a: { kind: 'other' } } })).toThrow(/lock/);
  });
});
