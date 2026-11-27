// Cheat 20: crash or stall the guard so it lets things through.
// Closed by: the guard fails closed, so a crash, a bad input or a timeout is a refusal.
// Ruling R16: every fail-closed reason contains the phrase "blocked to be safe". These are the only
// tests that may see it; every other denial test rejects it (see expectDenied in calls.ts).
import { describe, expect, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import type { HookResult } from '../helpers/app.ts';
import { expectDenied, expectPlain, write } from '../helpers/calls.ts';

function expectFailClosed(r: HookResult): void {
  expectDenied(r, undefined, { failClosed: true });
  expectPlain(r.reason);
}

describe('cheat 20: the guard fails closed', () => {
  test('input that is not valid JSON is refused with a plain reason', async () => {
    const app = await makeApp({ phase: 'build' });
    expectFailClosed(await app.hook({ hook_event_name: 'PreToolUse' }, { stdin: '{"hook_event_name": "PreToolUse", "tool_na' }));
  });

  test('a tool_input that is a string is refused with a plain reason', async () => {
    const app = await makeApp({ phase: 'build' });
    const odd = { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: 'not an object' as unknown as Record<string, unknown> };
    expectFailClosed(await app.hook(odd));
  });

  test('a guard that throws (SEAM_TEST_FORCE_THROW) refuses with a plain reason', async () => {
    const app = await makeApp({ phase: 'build' });
    expectFailClosed(await app.hook(write(app, 'notes.md', 'hello\n'), { env: { SEAM_TEST_FORCE_THROW: '1' } }));
  });

  test('a guard that hangs (SEAM_TEST_FORCE_HANG) still answers within 25 s, with a refusal', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(write(app, 'notes.md', 'hello\n'), { env: { SEAM_TEST_FORCE_HANG: '1' } });
    expectFailClosed(r);
    expect(r.ms, 'the hook did not really hang, so this tested nothing').toBeGreaterThan(1000);
    expect(r.ms, 'the hook took too long to answer').toBeLessThan(25_000);
  }, 30_000);
});
