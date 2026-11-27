// Running the guard's decision in a worker thread, so a decision that never gives the thread back (a
// huge parse, a long hash, a loop) is still cut off. The main thread does none of the work and owns all
// the output: it starts the clock, hands the request to the worker, and prints whatever comes back. If
// the worker has not answered in time, or fails, or stops without an answer, the main thread prints the
// refusal itself (live checks c and d: a hook that crashes, is killed or times out lets the call go ahead,
// so the hook must answer first). The worker is stopped; the hook then exits.
import { Worker } from 'node:worker_threads';
import { readGuardEnv } from '../config/env.ts';
import { RECORD_TIMEOUT_MS } from '../config/limits.ts';
import type { HookInput } from '../types.ts';
import { describeError, internalError, refusal, TOOK_TOO_LONG } from './output.ts';
import type { HookEvent, HookOutput } from './output.ts';

/** What the worker is asked to do: decide a request, or count a refusal the main thread made. */
export type WorkerJob =
  | { kind: 'run'; raw: string; env: NodeJS.ProcessEnv }
  | { kind: 'record'; root: string; dataDir: string; input: HookInput; event: HookEvent; reason: string };

/** What the worker says back. `root` comes first, as soon as the project is known. */
export type WorkerMessage =
  | { kind: 'root'; root: string }
  | { kind: 'answer'; out: HookOutput }
  | { kind: 'recorded'; failure: string };

export interface Supervision {
  /** The worker's script (dist/hook-worker.mjs, next to the hook). */
  workerUrl: URL;
  raw: string;
  /** Only the variables the guard reads (see guardEnvVars). */
  env: NodeJS.ProcessEnv;
  input: HookInput;
  event: HookEvent;
  /** How long the worker has to answer. */
  timeoutMs: number;
  /** How long counting a refusal may take afterwards. */
  recordMs?: number;
}

/** Count a refusal in a short-lived second worker, so that the main thread never touches the files. Gives '' or why not. */
function recordInWorker(url: URL, job: WorkerJob, ms: number): Promise<string> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(url, { workerData: job });
    } catch (err) {
      resolve(`this block could not be recorded: ${describeError(err)}`);
      return;
    }
    const done = (failure: string): void => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(failure);
    };
    const timer = setTimeout(() => done('this block could not be recorded: it took too long'), ms);
    worker.on('message', (m: WorkerMessage) => {
      if (m.kind === 'recorded') done(m.failure);
    });
    worker.on('error', (err) => done(`this block could not be recorded: ${describeError(err)}`));
    worker.on('exit', () => done('this block could not be recorded: its worker stopped'));
  });
}

/**
 * Decide the request in a worker and give back what the hook should print. Never rejects: the worker
 * running out of time, throwing, or stopping without an answer is a refusal (denied before a tool,
 * blocked after one), counted in the project if the worker had got far enough to say which it was.
 */
export function supervise(s: Supervision): Promise<HookOutput> {
  return new Promise((resolve) => {
    let root: string | null = null;
    let settled = false;
    let worker: Worker;
    try {
      worker = new Worker(s.workerUrl, { workerData: { kind: 'run', raw: s.raw, env: s.env } satisfies WorkerJob });
    } catch (err) {
      resolve(refusal(s.event, internalError(err)));
      return;
    }
    const timer = setTimeout(() => fail(TOOK_TOO_LONG), s.timeoutMs);

    function settle(): boolean {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      return true;
    }
    function fail(reason: string): void {
      if (!settle()) return;
      const dataDir = readGuardEnv(s.env).dataDir;
      if (root === null || dataDir === null) {
        resolve(refusal(s.event, reason));
        return;
      }
      const job: WorkerJob = { kind: 'record', root, dataDir, input: s.input, event: s.event, reason };
      void recordInWorker(s.workerUrl, job, s.recordMs ?? RECORD_TIMEOUT_MS).then((failure) =>
        resolve(refusal(s.event, failure === '' ? reason : `${reason} (${failure})`)),
      );
    }

    worker.on('message', (m: WorkerMessage) => {
      if (m.kind === 'root') root = m.root;
      else if (m.kind === 'answer' && settle()) resolve(m.out);
    });
    worker.on('error', (err) => fail(internalError(err)));
    worker.on('messageerror', (err) => fail(internalError(err)));
    worker.on('exit', () => fail(internalError('the guard worker stopped without answering')));
  });
}
