// Test helper: where the tests make their throwaway folders. They all go under the one per-run parent folder
// that test/global-setup.ts makes (and removes at the end of the run), and each test file removes its own when it finishes.
import { mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, inject } from 'vitest';
import { removeAll } from './remove.ts';

const made: string[] = [];
afterAll(() => removeAll(made.splice(0)));

/** The folder the global setup made for this run. */
function scratchRoot(): string {
  const root: unknown = inject('seamScratch');
  if (typeof root !== 'string') throw new Error('Test setup: there is no scratch folder. Run the tests through vitest.config.ts, which loads test/global-setup.ts.');
  return root;
}

/** A new empty folder under the run's scratch folder (its real path, so it matches what the guard resolves), removed when the test file ends. */
export function scratchDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(scratchRoot(), prefix)));
  made.push(dir);
  return dir;
}
