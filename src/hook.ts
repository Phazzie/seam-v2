// The hook entry point: Claude Code runs `node dist/hook.mjs` for every tool call, with the request as
// JSON on stdin. It prints a refusal as JSON, or nothing. A hook that crashes or runs out of time does
// not stop the tool call (live checks c and d), so this file never lets either happen: the whole run,
// reading stdin included, has to answer inside the guard's own time limit, and any error is a refusal.
import { currentEnv } from './config/env.ts';
import { GUARD_TIMEOUT_MS, raceDeadline } from './guard/deadline.ts';
import { internalError, refusal, TOOK_TOO_LONG } from './guard/output.ts';
import type { HookOutput } from './guard/output.ts';
import { runHook } from './guard/run.ts';

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
  const raw = await raceDeadline<string | null>(readStdin, GUARD_TIMEOUT_MS, () => null);
  if (raw === null) return finish(refusal('PreToolUse', TOOK_TOO_LONG));
  const left = Math.max(1, GUARD_TIMEOUT_MS - (Date.now() - started));
  finish(await runHook(raw, currentEnv(), left));
}

main().catch((err: unknown) => finish(refusal('PreToolUse', internalError(err))));
