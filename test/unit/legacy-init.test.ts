// R80 (Codex on PR #25): `seam init --legacy old` (and --app-root) are kept in .seam/env.json, but the guard classified paths by what the
// PLAN says (plan.legacyRoot, plan.appRoot), and the plan does not exist yet at init. So the old app was not protected until the plan
// named it, and the first snapshot did not hold it. The guard now takes both from env.json when there is no plan, or when the plan
// does not set them (the plan wins when it does), from init on.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildCtx } from '../../src/guard/context.ts';
import { classify } from '../../src/lib/paths.ts';
import { makeApp } from '../helpers/app.ts';
import { expectAllowed, expectBlocked, expectDenied, post, pre } from '../helpers/calls.ts';
import { plainFolder } from '../helpers/cli.ts';
import type { Folder } from '../helpers/cli.ts';
import { put } from '../helpers/project.ts';

const LEGACY = /the old app is protected/i;
const bash = post('Bash', { command: 'x' });

/** A git folder with the practice plan (which names no old app), an old app in `old/`, and `seam init --legacy old` run on it. */
async function withLegacy(args: string[] = ['--legacy', 'old'], noPlan = false): Promise<Folder> {
  const f = plainFolder();
  put(f.root, 'old/x.ts', 'export const old = 1;\n');
  put(f.root, 'old/notes.md', 'old notes\n');
  if (noPlan) rmSync(join(f.root, 'plan/plan.json'));
  const init = await f.cli(['init', ...args]);
  expect(init.exitCode, init.stdout + init.stderr).toBe(0);
  return f;
}
/** The main AI's Write of `rel`, and its Edit of `rel`, as the hook gets them. */
const writes = (f: Folder, rel: string) => f.hook(pre('Write', { file_path: join(f.root, rel), content: 'x' }));
const edits = (f: Folder, rel: string) => f.hook(pre('Edit', { file_path: join(f.root, rel), old_string: 'old', new_string: 'older' }));

describe.each([['no plan yet', true], ['a plan that names no old app', false]])('seam init --legacy old with %s', (_what, noPlan) => {
  test('the main AI may not write, edit or add to the old app, from init on', async () => {
    const f = await withLegacy(['--legacy', 'old'], noPlan);
    expectDenied(await writes(f, 'old/notes.md'), LEGACY);
    expectDenied(await writes(f, 'old/new.md'), LEGACY);
    expectDenied(await edits(f, 'old/x.ts'), LEGACY);
  });

  test('a command that changes a file of the old app is put back, and one that adds a file is moved aside (the first snapshot held it)', async () => {
    const f = await withLegacy(['--legacy', 'old'], noPlan);
    put(f.root, 'old/x.ts', 'export const old = 2;\n');
    expectBlocked(await f.hook(bash), /old\/x\.ts was changed outside the rules and has been put back/);
    expect(f.read('old/x.ts')).toBe('export const old = 1;\n');
    put(f.root, 'old/added.txt', 'new');
    expectBlocked(await f.hook(bash), /old\/added\.txt is a new file that has no place there/);
    expect(existsSync(join(f.root, 'old/added.txt'))).toBe(false);
  });

  test('without --legacy the same folder is not protected (the control)', async () => {
    const f = await withLegacy([], noPlan);
    expectAllowed(await writes(f, 'old/notes.md'));
  });
});

describe('seam init --app-root app', () => {
  test('the folder is the app folder for the guard from init on: contracts inside it are frozen, as at the repo root', async () => {
    const f = plainFolder();
    put(f.root, 'app/keep.txt', 'x');
    rmSync(join(f.root, 'plan/plan.json'));
    expect((await f.cli(['init', '--app-root', 'app'])).exitCode).toBe(0);
    expectDenied(await writes(f, 'app/contracts/notes.md'), /contracts/i);
  });

  test('without it, the same path is only a folder called app', async () => {
    const f = plainFolder();
    put(f.root, 'app/keep.txt', 'x');
    rmSync(join(f.root, 'plan/plan.json'));
    expect((await f.cli(['init'])).exitCode).toBe(0);
    expectAllowed(await writes(f, 'app/contracts/notes.md'));
  });
});

describe('the context takes the folders from env.json when the plan does not set them', () => {
  const setEnv = (app: { dataDir: string; writeRaw: (rel: string, text: string) => void }, extra: Record<string, string>): void =>
    app.writeRaw('.seam/env.json', JSON.stringify({ dataDir: app.dataDir, ...extra }));

  test('a plan with the default app folder and no old app: env.json supplies both', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    setEnv(app, { appRoot: 'envapp', legacyRoot: 'envold' });
    const ctx = buildCtx(app.root, app.dataDir, app.pluginRoot, new Date());
    expect(ctx.appRoot).toBe(join(app.root, 'envapp'));
    expect(ctx.legacyRoot).toBe('envold');
  });

  test('the plan wins where it does set them', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const plan = JSON.parse(app.read('plan/plan.json')) as Record<string, unknown>;
    app.writeRaw('plan/plan.json', JSON.stringify({ ...plan, appRoot: 'planapp', legacyRoot: 'planold' }));
    setEnv(app, { appRoot: 'envapp', legacyRoot: 'envold' });
    const ctx = buildCtx(app.root, app.dataDir, app.pluginRoot, new Date());
    expect(ctx.appRoot).toBe(join(app.root, 'planapp'));
    expect(ctx.plan?.legacyRoot).toBe('planold');
  });

  test('with neither, nothing changes: the repo root, and no old app', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const ctx = buildCtx(app.root, app.dataDir, app.pluginRoot, new Date());
    expect(ctx.appRoot).toBe(app.root);
    expect(ctx.legacyRoot ?? null).toBeNull();
  });

  test('an env.json that cannot be read is put back from the guard\'s record, like the plan, the lock and the state', async () => {
    const f = await withLegacy();
    const original = f.read('.seam/env.json');
    f.ctx(); // reads fine
    put(f.root, '.seam/env.json', '{ garbage');
    expectBlocked(await f.hook(bash), /\.seam\/env\.json was changed outside the rules and has been put back/);
    expect(f.read('.seam/env.json')).toBe(original);
    expect(readFileSync(join(f.root, '.seam/env.json'), 'utf8')).toContain('"legacyRoot": "old"');
    expect(classify(f.ctx(), join(f.root, 'old/notes.md'))).toBe('legacy'); // and the old app is still protected (the run is halted for the tamper, so a Write now is refused for that)
  });
});
