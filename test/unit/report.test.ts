// `seam report` (Task 13): the owner's one-screen, plain-English status page: where the project is, and what the guard said no to.
import { rmSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { spanWords } from '../../src/cli/report.ts';
import { recordBlock } from '../../src/lib/store.ts';
import { makeApp } from '../helpers/app.ts';
import { TOTAL } from '../helpers/code.ts';
import { GREETING, HOUR, MIN, inPhase, reportOf, setState } from '../helpers/reporting.ts';

describe('how long, in words', () => {
  test.each([
    [0, 'less than a minute'], [29_000, 'less than a minute'], [31_000, '1 minute'], [MIN, '1 minute'], [25 * MIN, '25 minutes'],
    [59 * MIN, '59 minutes'], [HOUR, '1 hour'], [2 * HOUR, '2 hours'], [2 * HOUR + 400, '2 hours'], [2 * HOUR + 5 * MIN, '2 hours 5 minutes'],
    [HOUR + MIN, '1 hour 1 minute'], [26 * HOUR, '1 day 2 hours'], [48 * HOUR, '2 days'],
  ])('%i ms is %s', (ms, words) => {
    expect(spanWords(ms)).toBe(words);
  });
});

describe('seam report says where the project is', () => {
  test('the phase, in words, and the project folder', async () => {
    const app = await inPhase('build');
    const out = reportOf(app);
    expect(out).toMatch(/^Seam report/);
    expect(out).toMatch(/Phase: build/i);
    expect(out).toMatch(/builders/i);
    expect(out.split('\n').length).toBeLessThanOrEqual(40);
  });

  test.each([['setup'], ['survey'], ['plan1'], ['probe'], ['plan2'], ['skeleton'], ['tests'], ['build'], ['flip'], ['cutover']] as const)('every phase has words: %s', async (phase) => {
    const out = reportOf(await makeApp({ phase }));
    expect(out).toContain(`Phase: ${phase}`);
    expect(out).not.toMatch(/undefined|\[object/);
  });

  test('files done, parked and left, and what is being built right now', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn: { file: GREETING, agentId: 'b-1' } });
    setState(app, (s) => ({ ...s, done: [TOTAL] }));
    const out = reportOf(app);
    expect(out).toMatch(/1 done, 0 parked, 1 left \(2 planned\)/);
    expect(out).toContain(`Building now: ${GREETING}`);
  });

  test('a parked file is counted and listed by name', async () => {
    const app = await inPhase('build');
    setState(app, (s) => ({ ...s, done: [TOTAL], parked: [GREETING] }));
    const out = reportOf(app);
    expect(out).toMatch(/1 done, 1 parked, 0 left \(2 planned\)/);
    expect(out).toMatch(new RegExp(`Parked[^\\n]*\\n\\s+- ${GREETING}`));
  });

  test('a path spelled with backslashes in the state still counts as done', async () => {
    const app = await inPhase('build');
    setState(app, (s) => ({ ...s, done: [TOTAL.replace(/\//g, '\\')] }));
    expect(reportOf(app)).toMatch(/1 done, 0 parked, 1 left/);
  });

  test('no plan yet: it says so instead of counting', async () => {
    const app = await makeApp({ phase: 'setup' });
    rmSync(app.abs('plan/plan.json'));
    const out = reportOf(app);
    expect(out).toMatch(/no plan yet/i);
    expect(out).not.toMatch(/\d+ left/);
  });

  test('a long parked list is cut, with how many were left out', async () => {
    const app = await inPhase('build');
    setState(app, (s) => ({ ...s, parked: Array.from({ length: 30 }, (_, i) => `src/gone/file${i}.ts`) }));
    const out = reportOf(app);
    expect(out).toContain('src/gone/file0.ts');
    expect(out).toMatch(/and 20 more/);
    expect(out.split('\n').length).toBeLessThanOrEqual(40);
  });
});

describe('blocks', () => {
  test('the count, and the last five in the order they happened', async () => {
    const app = await inPhase('build');
    for (let i = 1; i <= 7; i += 1) recordBlock(app.root, app.dataDir, 'main', `tried thing number ${i}`);
    const out = reportOf(app);
    expect(out).toMatch(/said no 7 times/);
    for (const n of [3, 4, 5, 6, 7]) expect(out).toContain(`main tried thing number ${n}`);
    for (const n of [1, 2]) expect(out).not.toContain(`thing number ${n}\n`);
    expect(out.indexOf('thing number 3')).toBeLessThan(out.indexOf('thing number 7'));
    expect(out).toMatch(/\d\d:\d\d main tried thing number 7/);
  });

  test('one block is "1 time", and none is said plainly', async () => {
    const app = await inPhase('build');
    expect(reportOf(app)).toMatch(/no blocks|has not said no/i);
    recordBlock(app.root, app.dataDir, 'builder', 'wrote outside its file');
    expect(reportOf(app)).toMatch(/said no 1 time\b/);
  });

  test('lines of the log that are not blocks are not shown as blocks', async () => {
    const app = await inPhase('build');
    recordBlock(app.root, app.dataDir, 'main', 'tried the one block');
    app.writeRaw('.seam/log.md', `${app.read('.seam/log.md')}10:00 Builder started on a file (try 1 of 2).\n`);
    const out = reportOf(app);
    expect(out).toContain('tried the one block');
    expect(out).not.toContain('Builder started');
  });
});
