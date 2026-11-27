// decideWrite, the role table, part 1 (rules 1, 2 and 5): the places nobody may write, the one thing a
// checker may, files outside the repo, and the roles that write nothing. Each case asks the decision
// directly. Part 2 is write-main.test.ts, part 3 write-builder.test.ts.
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { asChecker, asMain } from '../helpers/app.ts';
import type { Who } from '../helpers/app.ts';
import { TOTAL } from '../helpers/code.ts';
import { ask, isAllowed, reasonOf, scene, theBuilder, writes } from '../helpers/decide.ts';
import type { Scene } from '../helpers/decide.ts';

let s: Scene;
beforeAll(async () => {
  s = await scene();
});

const put = (path: string, who: Who, ctx = s.ctx) => ask(s, 'Write', { file_path: path, content: 'x\n' }, who, ctx);
const abs = (rel: string): string => s.app.abs(rel);

const EVERYONE: [string, () => Who][] = [
  ['the main AI', asMain],
  ['the builder whose turn it is', theBuilder],
  ['a checker', () => asChecker()],
];

describe('rule 1: protected places are refused for every role, with the reason said', () => {
  const PLACES: [string, () => string, RegExp][] = [
    ['the state file', () => abs('.seam/state.json'), /records.*scripts/i],
    ['the lock', () => abs('.seam/lock.json'), /records/i],
    ['a new file in .seam', () => abs('.seam/review/new.md'), /records/i],
    ['.claude/settings.json', () => abs('.claude/settings.json'), /protected/i],
    ['CLAUDE.md', () => abs('CLAUDE.md'), /protected/i],
    ["the owner's Claude settings", () => join(homedir(), '.claude', 'settings.json'), /protected/i],
    ["a file in the plugin's own folder", () => join(s.app.pluginRoot, 'dist', 'hook.mjs'), /plugin's own files/i],
    ["the plugin's data folder", () => join(s.app.dataDir, 'projects.json'), /protected/i],
    ['a fixture', () => abs('fixtures/order.json'), /fixtures.*(?:protected|frozen)/i],
    ['a probe fixture', () => abs('probes/fixtures/order.json'), /fixtures.*(?:protected|frozen)/i],
    ['package.json', () => abs('package.json'), /config files are frozen; they're written by the seam scripts/],
    ['vitest.config.ts', () => abs('vitest.config.ts'), /frozen/],
    ['a config file the plan lists', () => abs('tsconfig.json'), /frozen/],
  ];
  describe.each(EVERYONE)('%s', (_who, who) => {
    test.each(PLACES)('%s', (_what, path, reason) => {
      expect(reasonOf(put(path(), who()))).toMatch(reason);
    });
  });

  test('the old app (the plan names it) is protected', () => {
    const ctx = { ...s.ctx, plan: { ...s.ctx.plan!, legacyRoot: 'old' } };
    expect(reasonOf(put(abs('old/app.js'), asMain(), ctx))).toMatch(/old app.*protected/i);
  });

  test('generated files (the plan lists them) are protected', () => {
    const ctx = { ...s.ctx, plan: { ...s.ctx.plan!, generated: ['gen'] } };
    expect(reasonOf(put(abs('gen/out.ts'), asMain(), ctx))).toMatch(/generated.*protected/i);
  });

  test('a different spelling of the same file gets the same answer', () => {
    expect(reasonOf(put(abs('src/../.seam/State.json'), asMain()))).toMatch(/records/i);
    expect(reasonOf(put(`${abs('.seam/state.json')}.`, asMain()))).toMatch(/records/i);
  });

  test('every refusal reads as a rule, not as the guard failing', () => {
    expect(reasonOf(put(abs('.seam/state.json'), asMain()))).not.toMatch(/blocked to be safe/i);
  });
});

describe('rule 1, the one exception: a checker writes its verdict', () => {
  test('a checker may write .seam/verdicts/<name>.json', () => {
    isAllowed(put(abs('.seam/verdicts/total.json'), asChecker()));
    isAllowed(ask(s, 'Edit', { file_path: abs('.seam/verdicts/total.json'), old_string: 'a', new_string: 'b' }, asChecker()));
  });

  test.each([
    ['anything else in .seam', '.seam/state.json'],
    ['a folder inside verdicts', '.seam/verdicts/more/total.json'],
    ['a verdict that is not json', '.seam/verdicts/total.md'],
    ['a path that climbs out of verdicts', '.seam/verdicts/../state.json'],
  ])('a checker may not write %s', (_what, rel) => {
    expect(reasonOf(put(abs(rel), asChecker()))).toMatch(/records/i);
  });

  test.each([
    ['the main AI', asMain],
    ['a builder', theBuilder],
  ])('%s may not write a verdict', (_who, who) => {
    expect(reasonOf(put(abs('.seam/verdicts/total.json'), who()))).toMatch(/records/i);
  });
});

describe('rule 2: outside the repo, and not protected, is allowed', () => {
  test.each(EVERYONE)('%s', (_who, who) => {
    isAllowed(put(join(tmpdir(), 'seam-write-test', 'notes.txt'), who()));
  });
});

describe('what a call names', () => {
  test('a write that names no file is refused in words', () => {
    expect(reasonOf(ask(s, 'Write', { content: 'x' }, asMain()))).toMatch(/doesn't name a file/);
    expect(reasonOf(ask(s, 'Write', { file_path: '', content: 'x' }, asMain()))).toMatch(/doesn't name a file/);
  });

  test('a call that names two files is judged on both: one protected one is enough to refuse it', () => {
    const both = { file_path: abs('notes.md'), notebook_path: abs('.seam/state.json'), content: 'x' };
    expect(reasonOf(ask(s, 'Write', both, asMain()))).toMatch(/records/i);
    isAllowed(ask(s, 'Write', { file_path: abs('notes.md'), notebook_path: abs('docs.md'), content: 'x' }, asMain()));
  });

  test('NotebookEdit is judged by notebook_path', () => {
    expect(reasonOf(ask(s, 'NotebookEdit', { notebook_path: abs('.claude/a.ipynb'), new_source: 'x' }, asMain()))).toMatch(/protected/i);
    isAllowed(ask(s, 'NotebookEdit', { notebook_path: abs('analysis.ipynb'), new_source: 'x' }, asMain()));
  });

  test('a relative path is taken from the session folder', () => {
    expect(reasonOf(ask(s, 'Write', { file_path: '.seam/state.json', content: 'x' }, asMain()))).toMatch(/records/i);
  });
});

describe('rule 5: roles that write nothing', () => {
  const NOBODY: [string, Who, RegExp][] = [
    ['a describer', { agent_id: 'd-1', agent_type: 'seam-v2:describer' }, /describer.*read/i],
    ['a surveyor', { agent_id: 's-1', agent_type: 'seam-v2:surveyor' }, /surveyor.*read/i],
    ['a design pass', { agent_id: 'x-1', agent_type: 'seam-v2:design' }, /design pass/i],
    ['another plugin agent', { agent_id: 'o-1', agent_type: 'other:thing' }, /read-only/i],
    ['an agent with no type', { agent_id: 'u-1' }, /read-only/i],
  ];
  test.each(NOBODY)('%s cannot write app code, docs or tests', (_who, who, reason) => {
    for (const path of [TOTAL, 'notes.md', 'tests/a.test.ts', 'contracts/order.ts', 'plan/FEATURES.md']) {
      expect(reasonOf(writes(s, path, 'x\n', who)), path).toMatch(reason);
    }
  });

  test('a checker writes only its verdict file', () => {
    expect(reasonOf(writes(s, TOTAL, 'x\n', asChecker()))).toMatch(/verdict/i);
    expect(reasonOf(writes(s, 'notes.md', 'x\n', asChecker()))).toMatch(/verdict/i);
  });
});
