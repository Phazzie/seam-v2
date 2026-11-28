// The heartbeat: every hook run in a seam project checks in, once, however the run ends; a run in a
// folder that is not a seam project, a handback and a request that cannot be read do not.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { decideWrite } from '../../src/guard/write.ts';
import { touchHeartbeat } from '../../src/lib/heartbeat.ts';
import { resolveReal } from '../../src/lib/paths.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { post, pre, write } from '../helpers/calls.ts';
import { call, envFor } from '../helpers/inproc.ts';
import { tempDir } from '../helpers/project.ts';

vi.mock('../../src/guard/write.ts', () => ({ decideWrite: vi.fn() }));
vi.mock('../../src/lib/heartbeat.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/heartbeat.ts')>();
  return { ...real, touchHeartbeat: vi.fn(real.touchHeartbeat) };
});

beforeEach(() => {
  vi.mocked(touchHeartbeat).mockClear();
  vi.mocked(decideWrite).mockReset().mockReturnValue({ kind: 'allow' });
});

describe('every hook run in a seam project checks in once, and no other does', () => {
  const beats = (): number => vi.mocked(touchHeartbeat).mock.calls.length;

  test.each([
    ['an allowed call', async (app: App) => call(app, pre('Read', { file_path: app.abs('a.ts') }))],
    ['a call after a tool', async (app: App) => call(app, post('Bash', { command: 'ls' }))],
    ['a call to a tool the guard does not decide', async (app: App) => call(app, pre('Agent', { prompt: 'x' }))],
    ['a denied call', async (app: App) => {
      vi.mocked(decideWrite).mockReturnValue({ kind: 'deny', reason: 'no' });
      return call(app, write(app, 'a.ts', 'x'));
    }],
    ['a call that crashes', async (app: App) => call(app, write(app, 'a.ts', 'x'), { env: envFor(app, { SEAM_TEST_FORCE_THROW: '1' }) })],
    ['a call that stalls', async (app: App) => call(app, write(app, 'a.ts', 'x'), { env: envFor(app, { SEAM_TEST_FORCE_HANG: '1' }), timeoutMs: 200 })],
    ['a call refused for its path', async (app: App) => call(app, pre('Read', { file_path: `\\\\?\\${app.root}\\bad.\\a.ts` }))],
  ])('%s: one check-in, for that project', async (_what, run) => {
    const app = await makeApp({ phase: 'build' });
    await run(app);
    expect(beats()).toBe(1);
    expect(vi.mocked(touchHeartbeat).mock.calls[0][0]).toBe(resolveReal(app.root, '.'));
    expect(vi.mocked(touchHeartbeat).mock.calls[0][1]).toBeInstanceOf(Date);
  });

  test('a folder that is not a seam project, a handback and an unreadable request do not check in', async () => {
    const app = await makeApp({ phase: 'build' });
    await call(app, pre('Read', { file_path: 'a.ts' }), { cwd: tempDir() });
    await call(app, pre('SubagentHandback', {}));
    await call(app, post('SubagentHandback', {}));
    await call(app, { hook_event_name: 'PreToolUse' }, { cwd: app.root });
    expect(beats()).toBe(0);
  });
});
