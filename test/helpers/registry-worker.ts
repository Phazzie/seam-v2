// Test helper: a child process that adds project roots to the project list at a fixed moment, so the list
// is changed by real processes at the same time (the way parallel hooks and `seam init` runs do).
// Usage: node registry-worker.ts <dataDir> <goAtMs> <root>...   (registers the roots one after the other)
import { sleepMs } from '../../src/lib/atomic.ts';
import { registerProject } from '../../src/lib/registry.ts';

const [dataDir, goAt, ...roots] = process.argv.slice(2);

// Wait until the agreed moment so every worker starts together.
while (Date.now() < Number(goAt)) sleepMs(1);
for (const root of roots) registerProject(root, dataDir);
