// The printer (src/guard/printer.ts), review fix critical 1(b): a failure to print must never end as
// silence, because silence is "allow". The sink is faked so printing can be made to fail.
import { describe, expect, test } from 'vitest';
import { makePrinter } from '../../src/guard/printer.ts';
import type { Sink } from '../../src/guard/printer.ts';
import { sniffEvent } from '../../src/guard/request.ts';
import type { HookEvent } from '../../src/guard/output.ts';

interface Fake {
  sink: Sink;
  out: string[];
  err: string[];
  exits: number[];
  /** The write callbacks kept back by `fake(..., true)`: Node calls them later, with the error if the write failed. */
  later: Array<(err?: Error | null) => void>;
}

/**
 * A sink whose stdout throws for the first `stdoutFails` writes (and stderr for `stderrFails`). Callbacks run at once,
 * or with `defer` are kept in `later` for the test to call, the way Node calls them after `write` has returned.
 */
function fake(stdoutFails = 0, stderrFails = 0, defer = false): Fake {
  const f: Fake = { out: [], err: [], exits: [], later: [], sink: undefined as unknown as Sink };
  let outFailsLeft = stdoutFails;
  let errFailsLeft = stderrFails;
  f.sink = {
    stdout: {
      write(text, done) {
        if (outFailsLeft > 0) {
          outFailsLeft -= 1;
          throw new TypeError('The "chunk" argument must be of type string');
        }
        f.out.push(text);
        if (defer) {
          if (done) f.later.push(done);
        } else {
          done?.();
        }
        return true;
      },
    },
    stderr: {
      write(text) {
        if (errFailsLeft > 0) {
          errFailsLeft -= 1;
          throw new Error('stderr is closed');
        }
        f.err.push(text);
        return true;
      },
    },
    exit: (code) => void f.exits.push(code),
  };
  return f;
}

const answer = { stdout: '{"decision":"block","reason":"x"}', exitCode: 0 };
const pre = (): HookEvent => 'PreToolUse';
const post = (): HookEvent => 'PostToolUse';

describe('makePrinter', () => {
  test('prints the answer, says the note on stderr, and leaves with the answer\'s exit code', () => {
    const f = fake();
    makePrinter(f.sink, pre).finish({ ...answer, note: 'because' });
    expect(f.out).toEqual([answer.stdout]);
    expect(f.err).toEqual(['seam guard: because\n']);
    expect(f.exits).toEqual([0]);
  });

  test('only the first answer counts', () => {
    const f = fake();
    const { finish } = makePrinter(f.sink, pre);
    finish(answer);
    finish({ stdout: 'second', exitCode: 0 });
    expect(f.out).toEqual([answer.stdout]);
    expect(f.exits).toEqual([0]);
  });

  test('if printing the answer throws, a refusal is printed instead (denied before a tool), and it is not silence', () => {
    const f = fake(1);
    makePrinter(f.sink, pre).finish({ stdout: undefined as unknown as string, exitCode: 0 });
    expect(f.out).toHaveLength(1);
    expect(JSON.parse(f.out[0])).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'seam guard hit an internal error and blocked to be safe: The "chunk" argument must be of type string',
      },
    });
    expect(f.exits).toEqual([0]);
  });

  test('the refusal is worded for the event: a block after a tool', () => {
    const f = fake(1);
    makePrinter(f.sink, post).finish(answer);
    expect(JSON.parse(f.out[0])).toMatchObject({ decision: 'block', reason: expect.stringMatching(/blocked to be safe/) });
  });

  test('after a failed print the refusal is the one answer: a later answer is ignored', () => {
    const f = fake(1);
    const { finish } = makePrinter(f.sink, pre);
    finish(answer); // fails, so the refusal goes out
    finish({ stdout: 'later', exitCode: 0 });
    expect(f.out).toHaveLength(1);
    expect(f.out[0]).toMatch(/blocked to be safe/);
  });

  test('if the note cannot be written, nothing was said yet, so a refusal goes out', () => {
    const f = fake(0, 1);
    makePrinter(f.sink, pre).finish({ ...answer, note: 'why' });
    expect(f.out).toHaveLength(1);
    expect(f.out[0]).toMatch(/blocked to be safe: stderr is closed/);
  });

  test('if even the refusal cannot be printed, it leaves with exit code 2 (a blocking error) and the reason on stderr', () => {
    const f = fake(2);
    makePrinter(f.sink, pre).finish(answer);
    expect(f.out).toEqual([]);
    expect(f.exits).toEqual([2]);
    expect(f.err.join('')).toMatch(/blocked to be safe: The "chunk" argument.*could not be printed either/);
  });

  test('and if stderr is gone too it still leaves with exit code 2', () => {
    const f = fake(2, 1);
    expect(() => makePrinter(f.sink, pre).finish(answer)).toThrow(/stderr is closed/);
    expect(f.exits).toEqual([2]);
  });
});

describe('a write that fails after write() returned (the callback gets the error)', () => {
  const closed = new Error('write EPIPE');

  test('a refusal that could not be written goes to stderr and the hook leaves blocking, never with 0 (which would be allow)', () => {
    const f = fake(0, 0, true);
    makePrinter(f.sink, pre).finish({ stdout: '{"hookSpecificOutput":{"permissionDecisionReason":"plan.json is frozen"}}', exitCode: 0 });
    expect(f.exits).toEqual([]); // not until the write has finished
    f.later[0](closed);
    expect(f.exits).toEqual([2]);
    expect(f.err.join('')).toMatch(/could not be written \(write EPIPE\), so it was blocked to be safe: .*plan\.json is frozen/);
  });

  test('so does a block after a tool', () => {
    const f = fake(0, 0, true);
    makePrinter(f.sink, post).finish(answer);
    f.later[0](closed);
    expect(f.exits).toEqual([2]);
    expect(f.err.join('')).toContain('"reason":"x"');
  });

  test('a write that went through leaves with the code of its answer, once', () => {
    const f = fake(0, 0, true);
    makePrinter(f.sink, pre).finish({ stdout: '{}', exitCode: 3 });
    f.later[0](null);
    expect(f.exits).toEqual([3]);
  });

  test('the refusal printed instead of a failed print can fail late too, with the same result', () => {
    const f = fake(1, 0, true);
    makePrinter(f.sink, pre).finish(answer);
    expect(f.out).toHaveLength(1); // the refusal
    f.later[0](closed);
    expect(f.exits).toEqual([2]);
    expect(f.err.join('')).toMatch(/could not be written \(write EPIPE\).*blocked to be safe/);
  });

  test('an error that comes with nothing to say (a silent answer) loses nothing: it leaves as it meant to', () => {
    const f = fake(0, 0, true);
    makePrinter(f.sink, pre).finish({ stdout: '', exitCode: 0 });
    f.later[0](closed);
    expect(f.exits).toEqual([0]);
    expect(f.err).toEqual([]);
  });

  test('if stderr is gone as well it still leaves with exit code 2', () => {
    const f = fake(0, 1, true);
    makePrinter(f.sink, pre).finish(answer);
    expect(() => f.later[0](closed)).toThrow(/stderr is closed/);
    expect(f.exits).toEqual([2]);
  });
});

describe('sniffEvent', () => {
  test.each([
    ['{"session_id":"s","hook_event_name":"PostToolUse","tool_na', 'PostToolUse'],
    ['{"hook_event_name" : "PostToolUse"}', 'PostToolUse'],
    ['{"hook_event_name":"PreToolUse"', 'PreToolUse'],
    ['{"tool_input":{"content":"hook_event_name PostToolUse"}', 'PreToolUse'],
    ['', 'PreToolUse'],
    ['garbage', 'PreToolUse'],
  ])('%s is taken as %s', (raw, event) => {
    expect(sniffEvent(raw)).toBe(event);
  });
});
