// The hook entry point: Claude Code runs `node dist/hook.mjs` for every tool call, with the request as
// JSON on stdin. It prints a refusal as JSON, or nothing. A hook that crashes, is killed or runs out of
// time does not stop the tool call (live checks c and d), so this file never lets that happen: the
// main thread only reads stdin, keeps the clock and prints. The guard's work is done in a worker thread
// (dist/hook-worker.mjs), which the main thread can stop when the time is up, whatever it is doing. The
// worker's first step is the cheap check for a call that cannot involve a seam project (guard/inert.ts);
// even that touches the file system, so it too runs under this clock and never on this thread.
import { currentEnv, guardEnvVars, readGuardEnv } from './config/env.ts';
import { raceDeadline } from './guard/deadline.ts';
import { internalError, refusal, TOOK_TOO_LONG } from './guard/output.ts';
import type { HookEvent } from './guard/output.ts';
import { makePrinter } from './guard/printer.ts';
import { prepare, sniffEvent } from './guard/request.ts';
import { supervise } from './guard/supervisor.ts';

const started = Date.now();
const received: Buffer[] = [];
let knownEvent: HookEvent | null = null;

/** The event of the request being handled: as parsed once it has been, until then as far as the text so far says. */
const eventNow = (): HookEvent => knownEvent ?? sniffEvent(Buffer.concat(received).toString('utf8'));

const { finish } = makePrinter({ stdout: process.stdout, stderr: process.stderr, exit: (code) => process.exit(code) }, eventNow);

async function readStdin(): Promise<string> {
  for await (const chunk of process.stdin) received.push(Buffer.from(chunk));
  return Buffer.concat(received).toString('utf8');
}

// Anything that escapes every try/catch (a timer callback, a promise nobody awaited) must still be a
// refusal, not a crash: a crash lets the tool call go ahead.
process.on('uncaughtException', (err) => finish(refusal(eventNow(), internalError(err))));
process.on('unhandledRejection', (err) => finish(refusal(eventNow(), internalError(err))));

async function main(): Promise<void> {
  if (process.stdin.isTTY) {
    process.stderr.write('seam guard: this is run by Claude Code, which sends the tool call on stdin.\n');
    process.exit(0);
  }
  const env = currentEnv();
  const guard = readGuardEnv(env);
  const raw = await raceDeadline<string | null>(readStdin, guard.timeoutMs, () => null);
  if (raw === null) return finish(refusal(eventNow(), TOOK_TOO_LONG));
  const ready = prepare(raw);
  if ('done' in ready) return finish(ready.done);
  knownEvent = ready.event;
  const workerUrl = new URL('./hook-worker.mjs', import.meta.url);
  const timeoutMs = Math.max(1, guard.timeoutMs - (Date.now() - started));
  finish(await supervise({ workerUrl, raw, env: guardEnvVars(env), input: ready.input, event: ready.event, timeoutMs }));
}

main().catch((err: unknown) => finish(refusal(eventNow(), internalError(err))));
