// Test helper: removing test scratch folders so that nothing is left behind and nothing outside them is touched.
// No vitest import here, so the global setup (which runs outside any test) can use it too.
import { lstatSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import { errorCode, retryBusy } from '../../src/lib/atomic.ts';

/** How long a folder that is still in use (a hook process not yet gone, a virus scanner) is waited for: 20 tries, 100 ms apart. */
const REMOVE_TRIES = 20;
const REMOVE_PAUSE_MS = 100;

/**
 * Remove every link (a symlink or a junction) under `dir`, as a link: only the link goes, never what it points at.
 * A recursive removal is safe on current Node, but a test folder holds links on purpose, so this does not rely on that.
 */
function removeLinks(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) retryBusy(`remove the link ${path}`, () => unlinkSync(path));
    else if (entry.isDirectory()) removeLinks(path);
  }
}

/**
 * Remove `dir` and everything in it. Links are taken away as links first, then the rest is removed, trying again
 * while Windows answers EBUSY, EPERM or ENOTEMPTY. A folder that is already gone is fine; any other failure is thrown.
 */
export function removeTree(dir: string): void {
  let top: Stats;
  try {
    top = lstatSync(dir);
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return; // already gone
    throw err;
  }
  if (top.isSymbolicLink()) {
    retryBusy(`remove the link ${dir}`, () => unlinkSync(dir));
    return;
  }
  removeLinks(dir);
  rmSync(dir, { recursive: true, force: true, maxRetries: REMOVE_TRIES, retryDelay: REMOVE_PAUSE_MS });
}

/**
 * Remove every folder in `dirs`. One that cannot be removed does not stop the others: all are tried, then a single
 * error names each one that stayed, so a leak is loud and complete.
 */
export function removeAll(dirs: readonly string[]): void {
  const stayed: string[] = [];
  for (const dir of dirs) {
    try {
      removeTree(dir);
    } catch (err) {
      stayed.push(`${dir} (${(err as Error).message})`);
    }
  }
  if (stayed.length > 0) throw new Error(`Could not remove ${stayed.length} test folder(s); remove them by hand:\n${stayed.join('\n')}`);
}
