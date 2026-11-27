// Test helper: a child process that hits the store at a fixed moment, so the lock is tried by real
// processes at the same time (the way parallel hooks do), not by calls one after another.
// Usage: node store-worker.ts <mode> <root> <dataDir> <goAtMs> [times]
//   incr         adds 1 to .seam/counter.txt inside withLock, with a pause between read and write
//   incr-report  the same, but an error is caught and printed as `{"error": "<message>"}` instead of
//                crashing, so a test can tell "refused loudly" from "crashed". Prints `{"error": null}` on success.
//   block        records one block as a builder (recordBlock)
//   update       adds 1 to state.blocks with updateState
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleepMs } from '../../src/lib/atomic.ts';
import { recordBlock, updateState, withLock } from '../../src/lib/store.ts';

const [mode, root, dataDir, goAt, times = '1'] = process.argv.slice(2);

function increment(): void {
  withLock(root, () => {
    const file = join(root, '.seam', 'counter.txt');
    const value = Number(readFileSync(file, 'utf8'));
    sleepMs(3); // widens the window a missing lock would lose an update in
    writeFileSync(file, String(value + 1));
  });
}

function once(n: number): void {
  if (mode === 'incr' || mode === 'incr-report') increment();
  else if (mode === 'block') recordBlock(root, dataDir, 'builder', `try ${process.pid}-${n}`);
  else if (mode === 'update') updateState(root, dataDir, (s) => ({ ...s, blocks: s.blocks + 1 }));
  else throw new Error(`unknown mode ${mode}`);
}

// Wait until the agreed moment so every worker starts together.
while (Date.now() < Number(goAt)) sleepMs(1);

if (mode === 'incr-report') {
  let error: string | null = null;
  for (let n = 0; n < Number(times) && error === null; n += 1) {
    try {
      once(n);
    } catch (err) {
      error = (err as Error).message; // reported on stdout for the test to read
    }
  }
  process.stdout.write(`${JSON.stringify({ error })}\n`);
} else {
  for (let n = 0; n < Number(times); n += 1) once(n);
}
