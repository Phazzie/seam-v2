// The test scratch folders: made under the run's parent folder, removed without following a link, and the run's
// own set-up and tear-down (test/global-setup.ts): the free-space check, the parent folder, and the sweep of dead runs.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { TestProject } from 'vitest/node';
import setup from '../global-setup.ts';
import { removeAll, removeTree } from '../helpers/remove.ts';
import { scratchDir } from '../helpers/scratch.ts';

afterEach(() => vi.unstubAllEnvs());

/** What `setup` hands to the tests: the scratch folder. */
function runSetup(): { scratch: string; teardown: () => void } {
  let scratch = '';
  const project = { provide: (_key: string, value: string) => { scratch = value; } } as unknown as TestProject;
  return { teardown: setup(project), scratch };
}

describe('scratchDir', () => {
  test('makes folders under the run\'s own parent folder', () => {
    const dir = scratchDir('seam-scratch-test-');
    expect(dirname(dir)).toMatch(/seam-test-\d+-\d+$/);
    expect(dir).toContain('seam-scratch-test-');
    expect(existsSync(dir)).toBe(true);
  });
});

describe('removeTree', () => {
  test('removes a link as a link and leaves what it points at', () => {
    const base = scratchDir('seam-scratch-test-');
    const outside = join(base, 'outside');
    const tree = join(base, 'tree');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep\n');
    mkdirSync(join(tree, 'deep'), { recursive: true });
    symlinkSync(outside, join(tree, 'deep', 'link'), 'junction');
    removeTree(tree);
    expect(existsSync(tree)).toBe(false);
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
  });

  test('a link given as the folder itself is removed as a link', () => {
    const base = scratchDir('seam-scratch-test-');
    const target = join(base, 'target');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'keep\n');
    symlinkSync(target, join(base, 'link'), 'junction');
    removeTree(join(base, 'link'));
    expect(existsSync(join(base, 'link'))).toBe(false);
    expect(existsSync(join(target, 'keep.txt'))).toBe(true);
  });

  test('a folder that is already gone is fine', () => {
    expect(() => removeTree(join(scratchDir('seam-scratch-test-'), 'never-made'))).not.toThrow();
  });
});

describe('removeAll', () => {
  test('one that fails does not stop the others, and the error names it', () => {
    const base = scratchDir('seam-scratch-test-');
    const [first, last] = [join(base, 'first'), join(base, 'last')];
    mkdirSync(first);
    mkdirSync(last);
    expect(() => removeAll([first, 'not\0a-path', last])).toThrow(/Could not remove 1 test folder/);
    expect(existsSync(first) || existsSync(last)).toBe(false);
  });
});

describe('the global setup', () => {
  test('refuses to start when the temp drive has less free space than needed, saying so plainly', () => {
    vi.stubEnv('SEAM_TEST_MIN_FREE_MB', String(Number.MAX_SAFE_INTEGER));
    expect(() => runSetup()).toThrow(/Less than 1 GB free on the temp drive.*free some space before running the full suite/);
  });

  test('a bad free-space override is refused, not ignored', () => {
    vi.stubEnv('SEAM_TEST_MIN_FREE_MB', 'lots');
    expect(() => runSetup()).toThrow(/must be a number of megabytes/);
  });

  test('makes the run\'s parent folder in the temp folder and its teardown removes it with everything inside', () => {
    vi.stubEnv('SEAM_TEST_MIN_FREE_MB', '0');
    const { scratch, teardown } = runSetup();
    expect(dirname(scratch)).toBe(realpathSync.native(tmpdir()));
    mkdirSync(join(scratch, 'seam-app-x'));
    writeFileSync(join(scratch, 'seam-app-x', 'file.txt'), 'x\n');
    teardown();
    expect(existsSync(scratch)).toBe(false);
  });

  test('sweeps the folder of a run that was killed, and leaves the folder of a run that is still going', () => {
    vi.stubEnv('SEAM_TEST_MIN_FREE_MB', '0');
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    const killedRun = join(tmpdir(), `seam-test-${dead}-1`);
    const liveRun = join(tmpdir(), `seam-test-${process.pid}-1`);
    mkdirSync(join(killedRun, 'seam-app-x'), { recursive: true });
    mkdirSync(liveRun, { recursive: true });
    const { teardown } = runSetup();
    try {
      expect(existsSync(killedRun)).toBe(false);
      expect(existsSync(liveRun)).toBe(true);
    } finally {
      teardown();
      removeTree(liveRun);
    }
  });
});
