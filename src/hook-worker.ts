// The worker thread of the hook (see guard/supervisor.ts): it does the guard's work and posts the answer
// to the main thread, which prints it. It never prints and never exits the process.
//
// It starts small. The first thing it does is the cheap question "can a seam project be involved at all?"
// (guard/inert.ts, which needs nothing but the path code); if not, it answers silence and is done. Only
// when a project may be involved does it load the rest (state, plan, lock, the decisions: zod and more)
// with `import()` and run `runHook`. Everything here runs under the main thread's clock: a stall, even a
// busy loop that no timer on this thread could interrupt (SEAM_TEST_FORCE_HANG, SEAM_TEST_FORCE_INERT_HANG),
// is ended by the main thread's timer and `terminate()`.
import { parentPort, workerData } from 'node:worker_threads';
import { readGuardEnv } from './config/env.ts';
import { whySeamPossible } from './guard/inert.ts';
import { SILENT } from './guard/output.ts';
import type { WorkerJob, WorkerMessage } from './guard/supervisor.ts';

function post(message: WorkerMessage): void {
  if (parentPort === null) throw new Error('hook-worker.mjs must be run as a worker thread of the hook');
  parentPort.postMessage(message);
}

function busyLoop(): never {
  for (;;) {
    // never gives the thread back
  }
}

const job = workerData as WorkerJob;
if (job.kind === 'record') {
  const { recordRefusal } = await import('./guard/record.ts');
  post({ kind: 'recorded', failure: recordRefusal(job.root, job.dataDir, job.input, job.event, job.reason) });
} else {
  const guard = readGuardEnv(job.env);
  const why = whySeamPossible(job.input, guard.dataDir, { stall: guard.forceInertHang ? busyLoop : undefined });
  if (why === null) {
    post({ kind: 'answer', out: SILENT });
  } else {
    post({ kind: 'note', text: `a seam project may be involved: ${why}` });
    const { runHook } = await import('./guard/run.ts');
    const out = await runHook(job.raw, job.env, { stall: busyLoop, onProject: (root) => post({ kind: 'root', root }) });
    post({ kind: 'answer', out });
  }
}
