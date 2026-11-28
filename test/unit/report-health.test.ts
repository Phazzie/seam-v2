// `seam report` (Task 13), the second half: the guard's silence, why a run is stopped, what waits for the owner, and the command.
import { describe, expect, test } from 'vitest';
import { requestApproval } from '../../src/cli/request.ts';
import { makeApp } from '../helpers/app.ts';
import { folderOf } from '../helpers/cli.ts';
import { HOUR, MIN, beat, inPhase, reportOf, setState } from '../helpers/reporting.ts';
import { ctxOf } from '../helpers/tamper.ts';

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
