// R82 (Codex on PR #25), two ways `seam init` went wrong on a folder that already has something:
//  1. A plan that is already in the folder was left out of the first snapshot (`plan: null`), so a file the plan protects as config
//     (plan.config, a custom.cfg say) was not recorded, and the next hook's scan took it for a new protected file and moved it away.
//  2. A folder whose .seam/state.json was deleted looked new to init, which then wrote a fresh state and a fresh record of the protected
//     files over the guard's saved ones: approvals, progress and halts gone, and unapproved changes to protected files accepted. If any
//     other sign of the project is left (.seam/env.json, its line in the project list, the guard's saved state or record of the protected
//     files), init refuses and sends the owner to `seam repair`. A folder with none of them is new, and starts as before.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { repair } from '../../src/cli/repair.ts';
import { loadRecord } from '../../src/guard/tamperrecord.ts';
import { rootKey } from '../../src/lib/store.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { plainFolder, window } from '../helpers/cli.ts';
import type { Folder } from '../helpers/cli.ts';
import { PLAN_TEXT } from '../helpers/code.ts';
import { put } from '../helpers/project.ts';

const bash = post('Bash', { command: 'git status' });
const recorded = (f: Folder): string[] => Object.keys(loadRecord({ root: f.root, dataDir: f.dataDir })?.files ?? {});

describe('a plan that is in the folder already is in the first snapshot', () => {
  const withCustomConfig = (): Folder => {
    const f = plainFolder();
    const plan = JSON.parse(PLAN_TEXT) as { config: string[] };
    put(f.root, 'plan/plan.json', `${JSON.stringify({ ...plan, config: [...plan.config, 'custom.cfg'] }, null, 2)}\n`);
    put(f.root, 'custom.cfg', 'setting=1\n');
    return f;
  };

  test('a file only plan.config protects is recorded by init, and is still there after the next hook', async () => {
    const f = withCustomConfig();
    const init = await f.cli(['init']);
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(recorded(f)).toContain('custom.cfg');
    expectAllowed(await f.hook(bash));
    expect(existsSync(join(f.root, 'custom.cfg'))).toBe(true);
    expect(readFileSync(join(f.root, 'custom.cfg'), 'utf8')).toBe('setting=1\n');
  });

  test('so is a plan with its own app folder and old app: the first snapshot is what the next hook sees', async () => {
    const f = plainFolder();
    put(f.root, 'app/keep.txt', 'x');
    put(f.root, 'old/x.ts', 'export const old = 1;\n');
    const plan = JSON.parse(PLAN_TEXT) as Record<string, unknown>;
    put(f.root, 'plan/plan.json', `${JSON.stringify({ ...plan, appRoot: 'app', legacyRoot: 'old' }, null, 2)}\n`);
    const init = await f.cli(['init', '--app-root', 'app', '--legacy', 'old']);
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(recorded(f)).toContain('old/x.ts');
    expectAllowed(await f.hook(bash));
    expect(existsSync(join(f.root, 'old/x.ts'))).toBe(true);
  });

  test('a folder with no plan starts as before', async () => {
    const f = plainFolder();
    rmSync(join(f.root, 'plan/plan.json'));
    const init = await f.cli(['init']);
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expectAllowed(await f.hook(bash));
  });
});

type Sign = 'env.json' | 'project list' | 'saved state' | 'saved record';

/** A project started by init, then with its state.json gone and every sign of it gone but `keep`. */
async function lostState(keep: Sign[]): Promise<Folder> {
  const f = plainFolder();
  const init = await f.cli(['init']);
  expect(init.exitCode, init.stdout + init.stderr).toBe(0);
  const mirror = join(f.dataDir, 'mirror', rootKey(f.root));
  rmSync(join(f.root, '.seam/state.json'));
  if (!keep.includes('env.json')) rmSync(join(f.root, '.seam/env.json'));
  if (!keep.includes('project list')) rmSync(join(f.dataDir, 'projects.json'));
  if (!keep.includes('saved state')) rmSync(join(mirror, 'state.json'));
  if (!keep.includes('saved record')) rmSync(join(mirror, 'protected.json'));
  return f;
}
const ALL: Sign[] = ['env.json', 'project list', 'saved state', 'saved record'];
const mirrorText = (f: Folder, file: string): string => readFileSync(join(f.dataDir, 'mirror', rootKey(f.root), file), 'utf8');

describe('a folder whose state.json is gone is not new while any sign of the project is left', () => {
  test.each<[Sign]>(ALL.map((sign) => [sign]))('only the %s is left: init refuses, and says to run seam repair', async (sign) => {
    const f = await lostState([sign]);
    const r = await f.cli(['init']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/is a seam project whose state file \(\.seam\/state\.json\) is gone/);
    expect(r.stderr).toMatch(/seam repair/);
    expect(r.stderr).toMatch(/approvals/);
    expect(existsSync(join(f.root, '.seam/state.json'))).toBe(false);
  });

  test('it changes nothing: the guard\'s saved state and record are as they were, and no state.json is written', async () => {
    const f = await lostState(ALL);
    const [state, record, env] = [mirrorText(f, 'state.json'), mirrorText(f, 'protected.json'), f.read('.seam/env.json')];
    expect((await f.cli(['init'])).exitCode).toBe(1);
    expect(mirrorText(f, 'state.json')).toBe(state);
    expect(mirrorText(f, 'protected.json')).toBe(record);
    expect(f.read('.seam/env.json')).toBe(env);
    expect(existsSync(join(f.root, '.seam/state.json'))).toBe(false);
  });

  test('seam repair, which it points to, puts the state back from the saved copy, with the approvals in it', async () => {
    const f = await lostState(ALL);
    const saved = mirrorText(f, 'state.json');
    expect((await f.cli(['init'])).exitCode).toBe(1);
    const w = window([], { byShortcut: () => false });
    expect(await repair(w.io, { root: f.root, dataDir: f.dataDir })).toBe(0);
    expect(f.read('.seam/state.json')).toBe(saved);
    expect(w.said.join('\n')).toMatch(/put back \.seam\/state\.json/i);
    const again = await f.cli(['init']);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toMatch(/is a seam project already/);
  });

  test('a folder that never was a project, with a .seam file of its own, starts as before', async () => {
    const f = plainFolder();
    put(f.root, '.seam/notes.txt', 'mine\n');
    const init = await f.cli(['init']);
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(f.read('.seam/state.json')).toContain('"phase": "setup"');
  });

  test('another project in the same data folder is not a sign of this one', async () => {
    const other = plainFolder();
    expect((await other.cli(['init'])).exitCode).toBe(0);
    const f = plainFolder();
    const r = await f.cli(['init'], { SEAM_DATA_DIR: other.dataDir });
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
  });
});
