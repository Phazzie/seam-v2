// Printing the hook's answer, so that a failure to print can never end as silence (silence is "allow").
// The sink is a parameter so the tests can make printing fail.
import { describeError, internalError, refusal } from './output.ts';
import type { HookEvent, HookOutput } from './output.ts';

export interface Sink {
  stdout: { write(text: string, done?: () => void): unknown };
  stderr: { write(text: string): unknown };
  exit(code: number): void;
}

/**
 * `finish(out)` prints `out` and leaves once the text is out (leaving sooner can cut a piped answer short).
 * Only the first answer counts, and it counts once printing has started: if printing throws, nothing was
 * said yet, so it tries again with a refusal worded for `event()` (the request's event, as far as it is
 * known); if even that cannot be printed it leaves with exit code 2, which Claude Code treats as a blocking
 * error, with the reason on stderr.
 */
export function makePrinter(sink: Sink, event: () => HookEvent): { finish(out: HookOutput): void } {
  let finished = false;

  function lastResort(err: unknown): void {
    const reason = internalError(err);
    finished = true;
    try {
      sink.stdout.write(refusal(event(), reason).stdout, () => sink.exit(0));
    } catch (again) {
      try {
        sink.stderr.write(`seam guard: ${reason} (and the refusal could not be printed either: ${describeError(again)})\n`);
      } finally {
        sink.exit(2);
      }
    }
  }

  function finish(out: HookOutput): void {
    if (finished) return;
    try {
      if (out.note !== undefined) sink.stderr.write(`seam guard: ${out.note}\n`);
      sink.stdout.write(out.stdout, () => sink.exit(out.exitCode));
      finished = true;
    } catch (err) {
      lastResort(err);
    }
  }

  return { finish };
}
