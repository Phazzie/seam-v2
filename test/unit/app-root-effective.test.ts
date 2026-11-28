// R81 (Codex on PR #25, P1): the app folder and the old app are the plan's, and where the plan keeps the default (`appRoot: "."`, no
// `legacyRoot`) they are .seam/env.json's (from `seam init --app-root` / `--legacy`). The guard's context used that, but writeLock, the
// freeze (what it fingerprints, what it checks is on disk) and the snapshot still read the plan's "." and looked in the wrong folder.
// One pair of helpers, effectiveAppRoot and effectiveLegacyRoot, is used by all of them. If the plan and env.json name two different
// folders, nothing is guessed: it is refused, saying which two values disagree and how to fix it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { approveCore } from '../../src/cli/approve.ts';
import { loadPending } from '../../src/cli/pending.ts';
import { requestApproval } from '../../src/cli/request.ts';
import type { SeamEnv } from '../../src/formats/env.ts';
import { loadPlan } from '../../src/formats/plan.ts';
import type { Plan } from '../../src/formats/plan.ts';
import { buildCtx } from '../../src/guard/context.ts';
import { snapshotProtected } from '../../src/guard/tamper.ts';
import { loadRecord } from '../../src/guard/tamperrecord.ts';
import { writeLock } from '../../src/lib/fingerprint.ts';
import { effectiveAppRoot, effectiveLegacyRoot, withEffectiveRoots } from '../../src/lib/roots.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, expectDenied, post, write } from '../helpers/calls.ts';
import { planFile, PLAN_TEXT, skeleton } from '../helpers/code.ts';
import { plainFolder } from '../helpers/cli.ts';
import { put } from '../helpers/project.ts';
import { ctxOf } from '../helpers/tamper.ts';

const TOTAL = 'src/pricing/total.ts';
const GREETING = 'src/greeting/Greeting.tsx';
const planWith = (changes: Partial<Plan>): Plan => ({ ...(loadPlan(join(import.meta.dirname, '../fixtures/practice-app')) as Plan), ...changes });
const env = (extra: Pick<SeamEnv, 'appRoot' | 'legacyRoot'> = {}): SeamEnv => ({ dataDir: 'x', ...extra });

describe('effectiveAppRoot and effectiveLegacyRoot', () => {
  test.each([
    ['the plan keeps the default, env.json names one', '.', { appRoot: 'app' }, 'app'],
    ['the plan names one, env.json names none', 'app', {}, 'app'],
    ['both name the same one', 'app', { appRoot: 'app' }, 'app'],
    ['both name it, spelled differently', 'app', { appRoot: './app/' }, 'app'],
    ['both name it, with backslashes', 'ui/app', { appRoot: 'ui\\app' }, 'ui/app'],
    ['neither names one', '.', {}, '.'],
  ])('app folder: %s', (_what, planRoot, envExtra, expected) => {
    expect(effectiveAppRoot(planWith({ appRoot: planRoot }), env(envExtra))).toBe(expected);
  });

  test('app folder: no plan yet, and no env.json', () => {
    expect(effectiveAppRoot(null, env({ appRoot: 'app' }))).toBe('app');
    expect(effectiveAppRoot(null, null)).toBe('.');
    expect(effectiveAppRoot(planWith({ appRoot: 'app' }), null)).toBe('app');
  });

  test.each([
    ['the plan has none, env.json names one', null, { legacyRoot: 'old' }, 'old'],
    ['the plan names one, env.json none', 'old', {}, 'old'],
    ['both name the same one', 'old', { legacyRoot: './old' }, 'old'],
    ['neither', null, {}, null],
  ])('old app: %s', (_what, planLegacy, envExtra, expected) => {
    expect(effectiveLegacyRoot(planWith({ legacyRoot: planLegacy }), env(envExtra))).toBe(expected);
  });

  test('two different app folders are refused, with both values and how to fix it', () => {
    const attempt = (): string => effectiveAppRoot(planWith({ appRoot: 'seam-app' }), env({ appRoot: 'app' }));
    expect(attempt).toThrow(/plan \(plan\/plan\.json\) says the app folder is "seam-app", but \.seam\/env\.json \(from seam init --app-root\) says "app"/);
    expect(attempt).toThrow(/set "appRoot" in plan\/plan\.json to "app"/);
  });

  test('two different old apps are refused too', () => {
    const attempt = (): string | null => effectiveLegacyRoot(planWith({ legacyRoot: 'older' }), env({ legacyRoot: 'old' }));
    expect(attempt).toThrow(/says the old app is "older", but \.seam\/env\.json \(from seam init --legacy\) says "old"/);
    expect(attempt).toThrow(/set "legacyRoot" in plan\/plan\.json to "old"/);
  });

  test('withEffectiveRoots is the plan with both folders filled in, and is the same plan again when applied twice', () => {
    const plan = planWith({ appRoot: '.', legacyRoot: null });
    const once = withEffectiveRoots(plan, env({ appRoot: 'app', legacyRoot: 'old' }));
    expect(once).toMatchObject({ appRoot: 'app', legacyRoot: 'old', seams: plan.seams });
    expect(withEffectiveRoots(once, env({ appRoot: 'app', legacyRoot: 'old' }))).toEqual(once);
  });
});

/** A project whose app is in `app/` (init --app-root app), whose plan keeps `appRoot: "."`, with the planned files, a test and a contract there. */
async function appInAppFolder(phase: 'tests' | 'build' = 'tests'): Promise<App> {
  const files: Record<string, string> = { 'app/tests/a.test.ts': 'export const a = 1;\n', 'app/contracts/c.ts': 'export type C = number;\n' };
  for (const path of [TOTAL, GREETING]) {
    const { seam, file } = planFile(path);
    files[`app/${path}`] = skeleton(seam, file);
  }
  const app = await makeApp({ phase, files });
  app.writeRaw('.seam/env.json', JSON.stringify({ dataDir: app.dataDir, appRoot: 'app' }));
  expect(JSON.parse(app.read('plan/plan.json'))).toMatchObject({ appRoot: '.' });
  return app;
}

describe('a project with the app in app/ and a plan that keeps ".": the lock, the freeze and the snapshot look in app/', () => {
  test('the context', async () => {
    const app = await appInAppFolder();
    const ctx = ctxOf(app);
    expect(ctx.appRoot).toBe(join(app.root, 'app'));
    expect(ctx.plan?.appRoot).toBe('app');
  });

  test('writeLock locks the planned files and the frozen folders that are in app/', async () => {
    const app = await appInAppFolder();
    const lock = writeLock(app.root, loadPlan(app.root)!); // the plan as it is on disk: appRoot "."
    expect(Object.keys(lock.files).sort()).toEqual(['app/contracts/c.ts', 'app/src/greeting/Greeting.tsx', 'app/src/pricing/total.ts', 'app/tests/a.test.ts', 'plan/plan.json']);
  });

  test('the snapshot holds the planned code in app/ (it is frozen from the tests phase on)', async () => {
    const app = await appInAppFolder();
    snapshotProtected(ctxOf(app));
    const rec = loadRecord({ root: app.root, dataDir: app.dataDir })!;
    expect(Object.keys(rec.files)).toEqual(expect.arrayContaining([`app/${TOTAL}`, `app/${GREETING}`, 'app/tests/a.test.ts', 'app/contracts/c.ts']));
  });

  test('the freeze: the request sees the planned files, fingerprints what the lock will cover, and the approval writes that lock and ends clean', async () => {
    const app = await appInAppFolder();
    snapshotProtected(ctxOf(app));
    requestApproval(ctxOf(app), 'freeze');
    const pending = loadPending(app.root)!;
    expect(Object.keys(pending.fingerprints).sort()).toEqual(['app/contracts/c.ts', 'app/src/greeting/Greeting.tsx', 'app/src/pricing/total.ts', 'app/tests/a.test.ts', 'plan/plan.json']);
    expect(approveCore({ typed: pending.code }, ctxOf(app))).toMatchObject({ ok: true, phase: 'build' });
    expect(existsSync(app.abs('.seam/lock.json'))).toBe(true);
    expectAllowed(await app.hook(post('Bash', { command: 'git status' })));
  });

  test('a planned file that is not in app/ is still "not on disk" for the freeze (it is looked for in app/ first, then the repo root, as before)', async () => {
    const app = await makeApp({ phase: 'tests', files: { 'app/tests/a.test.ts': 'export {};\n' } });
    app.writeRaw('.seam/env.json', JSON.stringify({ dataDir: app.dataDir, appRoot: 'app' }));
    expect(() => requestApproval(ctxOf(app), 'freeze')).toThrow(/in the plan but not on disk/);
  });
});

describe('a plan and env.json that name different folders', () => {
  test('the context is refused, saying which two values disagree', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('plan/plan.json', JSON.stringify({ ...(JSON.parse(PLAN_TEXT) as object), appRoot: 'seam-app' }));
    app.writeRaw('.seam/env.json', JSON.stringify({ dataDir: app.dataDir, appRoot: 'app' }));
    expect(() => buildCtx(app.root, app.dataDir, app.pluginRoot, new Date())).toThrow(/says the app folder is "seam-app", but \.seam\/env\.json.*says "app"/s);
  });

  test('the main AI is refused a plan that would disagree with env.json, with the same words, so it can fix it', async () => {
    const app = await makeApp({ phase: 'plan1' });
    app.writeRaw('.seam/env.json', JSON.stringify({ dataDir: app.dataDir, appRoot: 'app', legacyRoot: 'old' }));
    const plan = JSON.parse(PLAN_TEXT) as Record<string, unknown>;
    const reason = (changes: Record<string, unknown>) => write(app, 'plan/plan.json', `${JSON.stringify({ ...plan, ...changes }, null, 2)}\n`);
    expectDenied(await app.hook(reason({ appRoot: 'other' })), /says the app folder is "other", but \.seam\/env\.json.*says "app"/s);
    expectDenied(await app.hook(reason({ legacyRoot: 'older' })), /says the old app is "older", but \.seam\/env\.json.*says "old"/s);
    expectAllowed(await app.hook(reason({ appRoot: 'app' })));
    expectAllowed(await app.hook(reason({ appRoot: '.' })));
    expectAllowed(await app.hook(reason({ appRoot: 'app', legacyRoot: 'old' })));
  });

  test('seam init refuses a folder the plan disagrees with, before it writes anything', async () => {
    const f = plainFolder();
    put(f.root, 'app/keep.txt', 'x');
    put(f.root, 'plan/plan.json', `${JSON.stringify({ ...(JSON.parse(PLAN_TEXT) as object), appRoot: 'seam-app' }, null, 2)}\n`);
    put(f.root, 'seam-app/keep.txt', 'x');
    const r = await f.cli(['init', '--app-root', 'app']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/says the app folder is "seam-app", but \.seam\/env\.json.*says "app"/s);
    expect(existsSync(join(f.root, '.seam'))).toBe(false);
    const agrees = await f.cli(['init', '--app-root', 'seam-app']);
    expect(agrees.exitCode, agrees.stdout + agrees.stderr).toBe(0);
  });
});
