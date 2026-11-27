// The hook entry point: Claude Code runs `node dist/hook.mjs` for every tool call, with the request as
// JSON on stdin. It prints a refusal as JSON, or nothing. A hook that crashes, is killed or runs out of
// time does not stop the tool call (live checks c and d), so this file never lets that happen: the
// main thread only reads stdin, keeps the clock and prints. The guard's work is done in a worker thread
// (dist/hook-worker.mjs), which the main thread can stop when the time is up, whatever it is doing.
import { currentEnv, guardEnvVars, readGuardEnv } from './config/env.ts';
import { raceDeadline } from './guard/deadline.ts';
import { internalError, refusal, TOOK_TOO_LONG } from './guard/output.ts';
import type { HookOutput } from './guard/output.ts';
import { prepare } from './guard/request.ts';
import { supervise } from './guard/supervisor.ts';

const started = Date.now();

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

let finished = false;

/** Print, then leave once the text is out (leaving sooner can cut a piped answer short). Only the first answer counts. */
function finish(out: HookOutput): void {
  if (finished) return;
  finished = true;
  if (out.note !== undefined) process.stderr.write(`seam guard: ${out.note}\n`);
  process.stdout.write(out.stdout, () => process.exit(out.exitCode));
}

// Anything that escapes every try/catch (a timer callback, a promise nobody awaited) must still be a
// refusal, not a crash: a crash lets the tool call go ahead.
process.on('uncaughtException', (err) => finish(refusal('PreToolUse', internalError(err))));
process.on('unhandledRejection', (err) => finish(refusal('PreToolUse', internalError(err))));

async function main(): Promise<void> {
  if (process.stdin.isTTY) {
    process.stderr.write('seam guard: this is run by Claude Code, which sends the tool call on stdin.\n');
    process.exit(0);
  }
  const env = currentEnv();
  const limit = readGuardEnv(env).timeoutMs;
  const raw = await raceDeadline<string | null>(readStdin, limit, () => null);
  if (raw === null) return finish(refusal('PreToolUse', TOOK_TOO_LONG));
  const ready = prepare(raw);
  if ('done' in ready) return finish(ready.done);
  const workerUrl = new URL('./hook-worker.mjs', import.meta.url);
  const timeoutMs = Math.max(1, limit - (Date.now() - started));
  finish(await supervise({ workerUrl, raw, env: guardEnvVars(env), input: ready.input, event: ready.event, timeoutMs }));
}

main().catch((err: unknown) => finish(refusal('PreToolUse', internalError(err))));
