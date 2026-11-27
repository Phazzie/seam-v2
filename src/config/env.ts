// The one place the guard reads the environment: the code rules allow `process.env` only under
// src/config/. Claude Code gives a plugin's hooks CLAUDE_PLUGIN_DATA and CLAUDE_PLUGIN_ROOT (live
// check l). The SEAM_TEST_* switches let a test make the guard crash or stall on purpose; they can
// only make it refuse more, never less. They are on only when set to exactly "1".

export interface GuardEnv {
  /** The plugin's data folder, or null when Claude Code did not say. */
  dataDir: string | null;
  /** The plugin's own folder, or null when Claude Code did not say. */
  pluginRoot: string | null;
  forceThrow: boolean;
  forceHang: boolean;
}

/** The environment of this process. Handed to `runHook`, so a test can pass its own instead. */
export function currentEnv(): NodeJS.ProcessEnv {
  return process.env;
}

const text = (value: string | undefined): string | null => (value === undefined || value === '' ? null : value);

/** What the guard needs from an environment (see GuardEnv). An empty value counts as not set. */
export function readGuardEnv(env: NodeJS.ProcessEnv): GuardEnv {
  return {
    dataDir: text(env.CLAUDE_PLUGIN_DATA),
    pluginRoot: text(env.CLAUDE_PLUGIN_ROOT),
    forceThrow: env.SEAM_TEST_FORCE_THROW === '1',
    forceHang: env.SEAM_TEST_FORCE_HANG === '1',
  };
}
