// Cheat 20: crash or stall the guard so it lets things through.
// Closed by: the guard fails closed, so a crash, a bad input or a timeout is a refusal.
import { describe, expect, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { expectDenied, expectPlain, write } from '../helpers/calls.ts';

describe('cheat 20: the guard fails closed', () => {
  test('input that is not valid JSON is refused with a plain reason', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook({ hook_event_name: 'PreToolUse' }, { stdin: '{"hook_event_name": "PreToolUse", "tool_na' });
    expectDenied(r);
    expectPlain(r.reason);
  });

  test('a tool_input that is a string is refused with a plain reason', async () => {
    const app = await makeApp({ phase: 'build' });
    const odd = { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: 'not an object' as unknown as Record<string, unknown> };
    const r = await app.hook(odd);
    expectDenied(r);
    expectPlain(r.reason);
  });

  test('a guard that throws (SEAM_TEST_FORCE_THROW) refuses with a plain reason', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(write(app, 'notes.md', 'hello\n'), { env: { SEAM_TEST_FORCE_THROW: '1' } });
    expectDenied(r);
    expectPlain(r.reason);
  });

  test('a guard that hangs (SEAM_TEST_FORCE_HANG) still answers within 25 s, with a refusal', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(write(app, 'notes.md', 'hello\n'), { env: { SEAM_TEST_FORCE_HANG: '1' } });
    expectDenied(r);
    expectPlain(r.reason);
    expect(r.ms, 'the hook took too long to answer').toBeLessThan(25_000);
  }, 30_000);
});
