// Vitest global setup, run once before and after the whole run (see vitest.config.ts).
//  - It refuses to start when the temp drive is nearly full: a full run copies dist/ for every test app and peaks in the GBs,
//    and a run that fills the drive dies half way and leaves its folders behind.
//  - It makes one parent folder for the run, %TEMP%/seam-test-<pid>-<time>, where every test folder goes
//    (test/helpers/scratch.ts), and removes it at the end, so nothing the run made outlives it.
//  - It removes the parent folders of earlier runs that were killed (their process is gone), since those never got to clean up.
import { mkdirSync, readdirSync, realpathSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { errorCode } from '../src/lib/atomic.ts';
import { removeTree } from './helpers/remove.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The folder every test folder of this run is made in. */
    seamScratch: string;
  }
}

const MB = 1024 * 1024;
const DEFAULT_MIN_FREE_MB = 1024;
const RUN_FOLDER = /^seam-test-(\d+)-\d+$/;

/** The free space the run needs. SEAM_TEST_MIN_FREE_MB lowers it, for running a few test files on a nearly full drive. */
function minFreeBytes(): number {
  const raw = process.env.SEAM_TEST_MIN_FREE_MB;
  if (raw === undefined || raw === '') return DEFAULT_MIN_FREE_MB * MB;
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb < 0) throw new Error(`SEAM_TEST_MIN_FREE_MB must be a number of megabytes, not "${raw}".`);
  return mb * MB;
}

function requireFreeSpace(dir: string): void {
  const stats = statfsSync(dir);
  const free = stats.bavail * stats.bsize;
  if (free < minFreeBytes()) {
    throw new Error(
      `Less than 1 GB free on the temp drive; free some space before running the full suite (${Math.floor(free / MB)} MB free). ` +
        'To run a few test files anyway, set SEAM_TEST_MIN_FREE_MB to the number of megabytes you can spare.',
    );
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 only asks whether the process exists
    return true;
  } catch (err) {
    return errorCode(err) !== 'ESRCH'; // EPERM means it exists but is not ours: still running
  }
}

/** Remove the run folders of runs that were killed. A folder that cannot be removed is reported, and does not stop this run. */
function removeDeadRuns(temp: string): void {
  for (const entry of readdirSync(temp, { withFileTypes: true })) {
    const pid = RUN_FOLDER.exec(entry.name)?.[1];
    if (pid === undefined || !entry.isDirectory() || isRunning(Number(pid))) continue;
    try {
      removeTree(join(temp, entry.name));
    } catch (err) {
      console.warn(`Could not remove the test folder an earlier run left (${entry.name}): ${(err as Error).message}`);
    }
  }
}

export default function setup(project: TestProject): () => void {
  const temp = tmpdir();
  requireFreeSpace(temp);
  removeDeadRuns(temp);
  const parent = join(temp, `seam-test-${process.pid}-${Date.now()}`);
  mkdirSync(parent);
  const scratch = realpathSync.native(parent);
  project.provide('seamScratch', scratch);
  return () => removeTree(scratch);
}
