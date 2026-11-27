// Two small promises of the hook: a path field that is null is just a field left out, the test
// switches only count when set to exactly 1, and SubagentHandback (the call every builder ends on) is
// never stopped, whatever state the project is in (R9).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { post, pre, write } from '../helpers/calls.ts';
import { blocksOf, call, envFor, heartbeatSeen } from '../helpers/inproc.ts';

const SILENT = { stdout: '', exitCode: 0 };

describe('small things', () => {
  test('a path field that is null is the same as one that is left out', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(await call(app, { ...pre('Glob', {}), tool_input: { pattern: '*.ts', path: null } })).toEqual(SILENT);
    expect(heartbeatSeen(app.root)).toBe(true);
  });

  test('the test switches are on only when set to exactly 1', async () => {
    const app = await makeApp({ phase: 'build' });
    for (const value of ['0', 'false', '']) {
      const env = envFor(app, { SEAM_TEST_FORCE_THROW: value, SEAM_TEST_FORCE_HANG: value });
      expect(await call(app, write(app, 'notes.md', 'x'), { env })).toEqual(SILENT);
    }
  });
});

describe('SubagentHandback is never stopped (R9)', () => {
  const handback = [pre('SubagentHandback', { message: 'done' }), post('SubagentHandback', { message: 'done' })];

  test.each(handback.map((input) => [input.hook_event_name, input] as const))('%s: silent in a seam project even when the guard is set to crash or stall', async (_event, input) => {
    const app = await makeApp({ phase: 'build' });
    const env = envFor(app, { SEAM_TEST_FORCE_THROW: '1', SEAM_TEST_FORCE_HANG: '1' });
    expect(await call(app, input, { env })).toEqual(SILENT);
    expect(blocksOf(app)).toBe(0);
  });

  test.each(handback.map((input) => [input.hook_event_name, input] as const))('%s: silent when the records are gone or unreadable', async (_event, input) => {
    const app = await makeApp({ phase: 'build' });
    app.writeRaw('.seam/state.json', '{ broken');
    expect(await call(app, input)).toEqual(SILENT);
    rmSync(join(app.root, '.seam'), { recursive: true, force: true });
    expect(await call(app, input)).toEqual(SILENT);
    expect(heartbeatSeen(app.root)).toBe(false);
  });

  test('a handback with an odd tool_input is still silent (the tool name is all that matters)', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(await call(app, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { file_path: 7 } })).toEqual(SILENT);
  });
});
