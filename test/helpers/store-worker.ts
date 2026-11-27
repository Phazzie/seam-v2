// Test helper: a child process that hits the store at a fixed moment, so the lock is tried by real
// processes at the same time (the way parallel hooks do), not by calls one after another.
// Usage: node store-worker.ts <mode> <root> <dataDir> <goAtMs> [times]
//   incr   adds 1 to .seam/counter.txt inside withLock, with a pause between read and write
//   block  records one block as a builder (recordBlock)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleepMs } from '../../src/lib/atomic.ts';
import { recordBlock, withLock } from '../../src/lib/store.ts';

const [mode, root, dataDir, goAt, times = '1'] = process.argv.slice(2);

// Wait until the agreed moment so every worker starts together.
while (Date.now() < Number(goAt)) sleepMs(1);

for (let n = 0; n < Number(times); n += 1) {
  if (mode === 'incr') {
    withLock(root, () => {
      const file = join(root, '.seam', 'counter.txt');
      const value = Number(readFileSync(file, 'utf8'));
      sleepMs(3); // widens the window a missing lock would lose an update in
      writeFileSync(file, String(value + 1));
    });
  } else if (mode === 'block') {
    recordBlock(root, dataDir, 'builder', `try ${process.pid}-${n}`);
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
}
