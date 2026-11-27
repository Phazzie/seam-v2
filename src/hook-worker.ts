// The worker thread of the hook (see guard/supervisor.ts): it does the guard's work and posts the answer
// to the main thread, which prints it. It never prints and never exits the process. A request to decide
// is run with `runHook`; SEAM_TEST_FORCE_HANG here is a busy loop, which no timer on this thread can
// interrupt, so only the main thread's clock and `terminate()` can end it.
import { parentPort, workerData } from 'node:worker_threads';
import { recordRefusal } from './guard/record.ts';
import { runHook } from './guard/run.ts';
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
  post({ kind: 'recorded', failure: recordRefusal(job.root, job.dataDir, job.input, job.event, job.reason) });
} else {
  const out = await runHook(job.raw, job.env, { stall: busyLoop, onProject: (root) => post({ kind: 'root', root }) });
  post({ kind: 'answer', out });
}
