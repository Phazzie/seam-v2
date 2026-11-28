// Printing the hook's answer, so that a failure to print can never end as silence (silence is "allow").
// The sink is a parameter so the tests can make printing fail.
import { describeError, internalError, refusal } from './output.ts';
import type { HookEvent, HookOutput } from './output.ts';

export interface Sink {
  /** `done` is Node's write callback: it gets the error when the text could not be written (a closed pipe, say), after `write` returned. */
  stdout: { write(text: string, done?: (err?: Error | null) => void): unknown };
  stderr: { write(text: string): unknown };
  exit(code: number): void;
}

/**
 * `finish(out)` prints `out` and leaves once the text is out (leaving sooner can cut a piped answer short).
 * Only the first answer counts, and it counts once printing has started: if printing throws, nothing was
 * said yet, so it tries again with a refusal worded for `event()` (the request's event, as far as it is
 * known); if even that cannot be printed it leaves with exit code 2, which Claude Code treats as a blocking
 * error, with the reason on stderr. The same goes for a failure that is only reported later, to the write
 * callback (a closed pipe): leaving with 0 then would be silence, so the answer goes to stderr and it leaves with 2.
 * (An answer that says nothing loses nothing when it is not printed, and leaves with its own exit code.)
 */
export function makePrinter(sink: Sink, event: () => HookEvent): { finish(out: HookOutput): void } {
  let finished = false;

  /** The callback of a write of `said`: leave with `code` once it is out; if it could not be written, say so on stderr and leave blocking. */
  function afterWrite(said: string, code: number): (err?: Error | null) => void {
    return (err) => {
      if (err === undefined || err === null || said === '') return sink.exit(code);
      try {
        sink.stderr.write(`seam guard: its answer could not be written (${describeError(err)}), so it was blocked to be safe: ${said}\n`);
      } finally {
        sink.exit(2);
      }
    };
  }

  function lastResort(err: unknown): void {
    const reason = internalError(err);
    finished = true;
    try {
      const refused = refusal(event(), reason).stdout;
      sink.stdout.write(refused, afterWrite(refused, 0));
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
      sink.stdout.write(out.stdout, afterWrite(out.stdout, out.exitCode));
      finished = true;
    } catch (err) {
      lastResort(err);
    }
  }

  return { finish };
}
