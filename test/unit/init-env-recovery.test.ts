// R84 (Codex on PR #25): `seam init` on a project whose setup is incomplete rewrote .seam/env.json with only the data folder, so after
// `init --app-root app --legacy old` and a deleted env.json the two folders were gone from it, and the guard's record of env.json (which
// still held them) put the original back on the next hook and HALTED the run, blaming the AI. Completing the setup now takes env.json from
// the guard's saved copy of it (the folders included), and the record agrees with what was written, so the next check is clean. Where
// there is no saved copy (the data folder was lost too) the folders can be given again with the same flags.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadState } from '../../src/formats/state.ts';
import { classify } from '../../src/lib/paths.ts';
import { expectAllowed, post } from '../helpers/calls.ts';
import { plainFolder } from '../helpers/cli.ts';
import type { Folder } from '../helpers/cli.ts';
import { put, tempDir } from '../helpers/project.ts';

const bash = post('Bash', { command: 'git status' });
/** `seam init` in the folder, with a desktop folder of its own handed in (the real desktop is not looked at). */
const again = (f: Folder, args: string[] = []) => f.cli(['init', ...args], { SEAM_DESKTOP_DIR: tempDir() });
const WHOLE = /setup was incomplete and is whole again/;
const envOf = (f: Folder): Record<string, string> => JSON.parse(f.read('.seam/env.json')) as Record<string, string>;

/** A folder started with `seam init --app-root app --legacy old`, its env.json as init wrote it. */
async function started(): Promise<{ f: Folder; original: string }> {
  const f = plainFolder();
  put(f.root, 'app/keep.txt', 'x');
  put(f.root, 'old/page.html', '<p>old</p>');
  const init = await again(f, ['--app-root', 'app', '--legacy', 'old']);
  expect(init.exitCode, init.stdout + init.stderr).toBe(0);
  return { f, original: f.read('.seam/env.json') };
}

describe('completing the setup of a project whose env.json is gone', () => {
  test('env.json comes back as it was, folders and all, and the next check is clean (no tampering, no halt)', async () => {
    const { f, original } = await started();
    rmSync(join(f.root, '.seam/env.json'));
    const init = await again(f);
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(init.stdout).toMatch(WHOLE);
    expect(f.read('.seam/env.json')).toBe(original);
    expect(envOf(f)).toMatchObject({ appRoot: 'app', legacyRoot: 'old' });
    const r = await f.hook(bash);
    expectAllowed(r);
    expect(r.stdout, 'the tamper check had something to say').toBe('');
    expect(loadState(f.root)?.halted).toBeNull();
    expect(f.read('.seam/env.json')).toBe(original);
  });

  test('the old app is protected again from that call on', async () => {
    const { f } = await started();
    rmSync(join(f.root, '.seam/env.json'));
    expect((await again(f)).exitCode).toBe(0);
    expect(classify(f.ctx(), join(f.root, 'old/page.html'))).toBe('legacy');
    expect(f.ctx().legacyRoot).toBe('old');
  });

  test('a changed old app is still caught afterwards: the record kept it', async () => {
    const { f } = await started();
    rmSync(join(f.root, '.seam/env.json'));
    expect((await again(f)).exitCode).toBe(0);
    put(f.root, 'old/page.html', '<p>changed</p>');
    await f.hook(bash);
    expect(f.read('old/page.html')).toBe('<p>old</p>');
  });
});

describe('where the guard has no saved copy (the data folder was lost too)', () => {
  const lostEverything = async (): Promise<Folder> => {
    const { f } = await started();
    rmSync(f.dataDir, { recursive: true, force: true });
    rmSync(join(f.root, '.seam/env.json'));
    return f;
  };

  test('the folders are given again with the same flags, and kept', async () => {
    const f = await lostEverything();
    const init = await again(f, ['--app-root', 'app', '--legacy', 'old']);
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(envOf(f)).toMatchObject({ dataDir: f.dataDir, appRoot: 'app', legacyRoot: 'old' });
    expect(f.ctx().legacyRoot).toBe('old');
  });

  test('without the flags env.json holds the data folder alone, as before', async () => {
    const f = await lostEverything();
    const init = await again(f);
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(envOf(f)).toEqual({ dataDir: f.dataDir });
  });

  test('a flag that is a folder that is not there is refused, before anything is written', async () => {
    const f = await lostEverything();
    const init = await again(f, ['--legacy', 'nowhere']);
    expect(init.exitCode).toBe(1);
    expect(init.stderr).toMatch(/--legacy nowhere: there is no such folder/);
    expect(existsSync(join(f.root, '.seam/env.json'))).toBe(false);
  });
});

describe('a flag that disagrees with the saved setup', () => {
  test('is refused in plain words, and env.json is not written', async () => {
    const { f } = await started();
    put(f.root, 'elsewhere/x.txt', 'x');
    rmSync(join(f.root, '.seam/env.json'));
    const init = await again(f, ['--legacy', 'elsewhere']);
    expect(init.exitCode).toBe(1);
    expect(init.stderr).toMatch(/--legacy elsewhere: this project's saved setup says "old"/);
    expect(existsSync(join(f.root, '.seam/env.json'))).toBe(false);
  });

  test('the same folder, spelled another way, is not a disagreement', async () => {
    const { f, original } = await started();
    rmSync(join(f.root, '.seam/env.json'));
    const init = await again(f, ['--legacy', './old/']);
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(readFileSync(join(f.root, '.seam/env.json'), 'utf8')).toBe(original);
  });
});
