// src/config/env.ts: the only place the guard reads the environment.
import { describe, expect, test } from 'vitest';
import { guardEnvVars, readGuardEnv } from '../../src/config/env.ts';
import { GUARD_TIMEOUT_MS } from '../../src/config/limits.ts';

describe('readGuardEnv', () => {
  test('nothing set: no folders, no switches, the full 20 seconds', () => {
    expect(readGuardEnv({})).toEqual({ dataDir: null, pluginRoot: null, forceThrow: false, forceHang: false, timeoutMs: 20_000 });
    expect(GUARD_TIMEOUT_MS).toBe(20_000);
  });

  test('folders are read as they are, and an empty value counts as not set', () => {
    expect(readGuardEnv({ CLAUDE_PLUGIN_DATA: 'C:/d', CLAUDE_PLUGIN_ROOT: 'C:/p' })).toMatchObject({ dataDir: 'C:/d', pluginRoot: 'C:/p' });
    expect(readGuardEnv({ CLAUDE_PLUGIN_DATA: '', CLAUDE_PLUGIN_ROOT: '' })).toMatchObject({ dataDir: null, pluginRoot: null });
  });

  test('the force switches are on only for exactly 1', () => {
    expect(readGuardEnv({ SEAM_TEST_FORCE_THROW: '1', SEAM_TEST_FORCE_HANG: '1' })).toMatchObject({ forceThrow: true, forceHang: true });
    for (const value of ['0', 'true', '', ' 1', '11']) {
      expect(readGuardEnv({ SEAM_TEST_FORCE_THROW: value, SEAM_TEST_FORCE_HANG: value })).toMatchObject({ forceThrow: false, forceHang: false });
    }
  });

  test('the time limit can be made shorter, never longer, and a bad value is the full 20 seconds', () => {
    expect(readGuardEnv({ SEAM_TEST_TIMEOUT_MS: '1500' }).timeoutMs).toBe(1500);
    expect(readGuardEnv({ SEAM_TEST_TIMEOUT_MS: '1' }).timeoutMs).toBe(1);
    for (const value of ['20000', '30000', '600000', '0', '-5', '1.5', 'soon', '', 'Infinity']) {
      expect(readGuardEnv({ SEAM_TEST_TIMEOUT_MS: value }).timeoutMs, value).toBe(20_000);
    }
  });
});

describe('guardEnvVars', () => {
  test('keeps only what the guard reads, for the worker', () => {
    const env = { CLAUDE_PLUGIN_DATA: 'd', CLAUDE_PLUGIN_ROOT: 'r', SEAM_TEST_FORCE_THROW: '1', SEAM_TEST_FORCE_HANG: '1', SEAM_TEST_TIMEOUT_MS: '9', PATH: '/bin', HOME: '/h' };
    expect(guardEnvVars(env)).toEqual({ CLAUDE_PLUGIN_DATA: 'd', CLAUDE_PLUGIN_ROOT: 'r', SEAM_TEST_FORCE_THROW: '1', SEAM_TEST_FORCE_HANG: '1', SEAM_TEST_TIMEOUT_MS: '9' });
    expect(guardEnvVars({ PATH: '/bin' })).toEqual({});
  });
});
