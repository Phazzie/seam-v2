// `seam report` (Task 13): the owner's one-screen, plain-English status page.
import { rmSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { requestApproval } from '../../src/cli/request.ts';
import { renderReport, spanWords } from '../../src/cli/report.ts';
import { recordBlock, updateState } from '../../src/lib/store.ts';
import type { Phase } from '../../src/types.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { TOTAL } from '../helpers/code.ts';
import { folderOf } from '../helpers/cli.ts';
import { ctxOf } from '../helpers/tamper.ts';

const GREETING = 'src/greeting/Greeting.tsx';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = new Date('2026-11-28T15:00:00');
const iso = (agoMs: number): string => new Date(NOW.getTime() - agoMs).toISOString();

const reportOf = (app: App, now: Date = NOW): string => renderReport(ctxOf(app), now);
const setState = (app: App, change: Parameters<typeof updateState>[2]): void => void updateState(app.root, app.dataDir, change);
const beat = (app: App, agoMs: number, gaps: { from: number; to: number }[] = []): void =>
  app.writeRaw('.seam/heartbeat.json', JSON.stringify({ lastSeen: iso(agoMs), gaps: gaps.map((g) => ({ from: iso(g.from), to: iso(g.to) })) }));
const inPhase = (phase: Phase): Promise<App> => makeApp({ phase, lock: true });

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

describe('heartbeat gaps', () => {
  test('a recorded gap is shown with when and how long', async () => {
    const app = await inPhase('build');
    beat(app, MIN, [{ from: 5 * HOUR, to: 3 * HOUR }]);
    const out = reportOf(app);
    expect(out).toMatch(/gap/i);
    expect(out).toMatch(/\b2 hours\b/);
    expect(out).not.toMatch(/\bno gaps?\b/i);
  });

  test('no gaps and a recent check-in: "No gaps"', async () => {
    const app = await inPhase('build');
    beat(app, MIN);
    const out = reportOf(app);
    expect(out).toMatch(/\bno gaps?\b/i);
    expect(out).not.toMatch(/hours?/);
  });

  test('silence that is still going on counts, though no check-in has closed it yet', async () => {
    const app = await inPhase('build');
    beat(app, 3 * HOUR);
    const out = reportOf(app);
    expect(out).toMatch(/gap/i);
    expect(out).toMatch(/\b3 hours\b/);
    expect(out).not.toMatch(/\bno gaps?\b/i);
  });

  test('silence of ten minutes or less is not a gap', async () => {
    const app = await inPhase('build');
    beat(app, 10 * MIN);
    expect(reportOf(app)).toMatch(/\bno gaps?\b/i);
  });

  test('silence outside the build is nothing to report (gaps are counted in the build only)', async () => {
    const app = await inPhase('plan1');
    beat(app, 5 * HOUR);
    expect(reportOf(app)).toMatch(/\bno gaps?\b/i);
  });

  test('no heartbeat file yet is not an error', async () => {
    const app = await inPhase('build');
    expect(() => reportOf(app)).not.toThrow();
    expect(reportOf(app)).toMatch(/\bno gaps?\b/i);
  });

  test('many gaps: the latest few, and how many came before', async () => {
    const app = await inPhase('build');
    beat(app, MIN, Array.from({ length: 12 }, (_, i) => ({ from: (30 - i * 2) * HOUR, to: (29 - i * 2) * HOUR })));
    const out = reportOf(app);
    expect(out).toMatch(/12 gaps/);
    expect(out).toMatch(/and 7 earlier/);
    expect(out.split('\n').length).toBeLessThanOrEqual(40);
  });
});

describe('what is stopping, and what is waiting', () => {
  test('a halted run says why and what the owner can do', async () => {
    const app = await inPhase('build');
    setState(app, (s) => ({ ...s, halted: 'the main AI changed a protected file: plan/plan.json' }));
    const out = reportOf(app);
    expect(out).toMatch(/STOPPED/);
    expect(out).toContain('the main AI changed a protected file: plan/plan.json');
    expect(out).toMatch(/Seam Approve/);
  });

  test('not halted: it does not say stopped', async () => {
    expect(reportOf(await inPhase('build'))).not.toMatch(/STOPPED|halted/i);
  });

  test('a request waiting for the owner is named, and its code is not shown', async () => {
    const app = await makeApp({ phase: 'tests', snapshot: true });
    requestApproval(ctxOf(app), 'park');
    const code = (JSON.parse(app.read('.seam/pending.json')) as { code: string }).code;
    const out = reportOf(app);
    expect(out).toMatch(/Waiting for you/);
    expect(out).toMatch(/park/i);
    expect(out).toMatch(/Seam Approve/);
    expect(out).not.toContain(code);
  });

  test('nothing waiting: it does not say so', async () => {
    expect(reportOf(await inPhase('build'))).not.toMatch(/Waiting for you/);
  });
});

describe('through the command', () => {
  test.each(['report', 'status'])('seam %s prints the report and exits 0', async (sub) => {
    const app = await inPhase('build');
    const r = await folderOf(app).cli([sub]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^Seam report/);
    expect(r.stdout).toMatch(/Phase: build/);
  });

});
