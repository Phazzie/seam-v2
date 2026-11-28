// R84 (Codex on PR #25): since R81 a plan and .seam/env.json that name different folders make the context refuse to build. A tool that
// the guard could not read in advance (a command) that changed the plan's app folder or old app, or env.json's, so that they disagree,
// therefore made every later hook fail, reads included, before the tamper check could put the saved file back: a lockout for good. A
// clash now counts as broken in the repair that follows a tool: whichever of the two was changed from the guard's record is put back
// from its kept copy, and the tamper check goes on from there. Where the record itself holds the clash, nothing can be put back, and the
// refusal stands, in plain words.
import { describe, expect, test } from 'vitest';
import { snapshotProtected } from '../../src/guard/tamper.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, expectDenied, post, pre } from '../helpers/calls.ts';
import { PLAN_TEXT } from '../helpers/code.ts';
import { ctxOf, recordOf } from '../helpers/tamper.ts';

type Change = (plan: string, env: string) => string;
const bash = post('Bash', { command: 'x' });
const read = (app: App) => pre('Read', { file_path: app.abs('plan/plan.json') });
const planWith = (changes: Record<string, unknown>): string => `${JSON.stringify({ ...(JSON.parse(PLAN_TEXT) as object), ...changes }, null, 2)}\n`;

/** A project in the build phase whose plan and env.json both name the old app `old` and the app folder `app`, the record taken after. */
async function agreeing(): Promise<{ app: App; plan: string; env: string }> {
  const app = await makeApp({ phase: 'build', lock: true });
  const plan = planWith({ appRoot: 'app', legacyRoot: 'old' });
  const env = `${JSON.stringify({ dataDir: app.dataDir, appRoot: 'app', legacyRoot: 'old' })}\n`;
  app.writeRaw('app/keep.txt', 'x');
  app.writeRaw('old/x.ts', 'export const old = 1;\n');
  app.writeRaw('plan/plan.json', plan);
  app.writeRaw('.seam/env.json', env);
  snapshotProtected(ctxOf(app));
  return { app, plan, env };
}

describe('a tool changes the plan or env.json so that they disagree', () => {
  test.each<[string, string, Change, 'plan' | 'env']>([
    ['the plan\'s app folder', 'plan/plan.json', (plan) => plan.replace('"appRoot": "app"', '"appRoot": "other"'), 'plan'],
    ['the plan\'s old app', 'plan/plan.json', (plan) => plan.replace('"legacyRoot": "old"', '"legacyRoot": "older"'), 'plan'],
    ['env.json\'s app folder', '.seam/env.json', (_plan, env) => env.replace('"appRoot":"app"', '"appRoot":"other"'), 'env'],
    ['env.json\'s old app', '.seam/env.json', (_plan, env) => env.replace('"legacyRoot":"old"', '"legacyRoot":"older"'), 'env'],
  ])('%s: the saved file is put back after the call, and the next calls work (reads included)', async (_what, file, change, which) => {
    const { app, plan, env } = await agreeing();
    app.writeRaw(file, change(plan, env));
    expect(app.read(file)).not.toBe(which === 'plan' ? plan : env);
    const after = await app.hook(bash);
    expect(app.read(file)).toBe(which === 'plan' ? plan : env);
    expect(`${after.stdout}${after.stderr}`).toContain(file);
    expect(`${after.stdout}${after.stderr}`).not.toMatch(/internal error/i);
    expectAllowed(await app.hook(read(app)));
  });

  test('the file that was not changed is not touched, nor reported', async () => {
    const { app, plan, env } = await agreeing();
    app.writeRaw('plan/plan.json', plan.replace('"appRoot": "app"', '"appRoot": "other"'));
    const after = await app.hook(bash);
    expect(`${after.stdout}${after.stderr}`).not.toContain('.seam/env.json');
    expect(app.read('.seam/env.json')).toBe(env);
  });
});

describe('where the guard\'s record holds the disagreement itself', () => {
  test('nothing can be put back, and the refusal is plain: both values and how to fix it', async () => {
    const { app } = await agreeing();
    const ctx = ctxOf(app); // built while they agree
    app.writeRaw('plan/plan.json', planWith({ appRoot: 'seam-app', legacyRoot: 'old' }));
    snapshotProtected(ctx); // the record takes the files as they are now
    expect(recordOf(app).files['plan/plan.json']).toBeDefined();
    const after = await app.hook(bash);
    expect(after.reason).toMatch(/says the app folder is "seam-app", but \.seam\/env\.json.*says "app"/s);
    expectDenied(await app.hook(read(app)), /says the app folder is "seam-app"/, { failClosed: true });
  });

  test('before a tool, a disagreement on disk is refused in plain words (the owner changed a file by hand): the error stands', async () => {
    const { app, plan } = await agreeing();
    app.writeRaw('plan/plan.json', plan.replace('"appRoot": "app"', '"appRoot": "other"'));
    expectDenied(await app.hook(read(app)), /says the app folder is "other", but \.seam\/env\.json.*says "app"/s, { failClosed: true });
    expect(app.read('plan/plan.json')).toContain('"appRoot": "other"');
  });
});
