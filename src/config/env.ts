// The one place the guard reads the environment: the code rules allow `process.env` only under
// src/config/. Claude Code gives a plugin's hooks CLAUDE_PLUGIN_DATA and CLAUDE_PLUGIN_ROOT (live
// check l). The SEAM_TEST_* switches let a test make the guard crash, stall (in the decision, or in the
// cheap check before it) or run out of time quickly; they can only make it refuse more, never less. The FORCE switches are on only when set to
// exactly "1"; SEAM_TEST_TIMEOUT_MS can only shorten the time limit.
import { GUARD_TIMEOUT_MS } from './limits.ts';

export interface GuardEnv {
  /** The plugin's data folder, or null when Claude Code did not say. */
  dataDir: string | null;
  /** The plugin's own folder, or null when Claude Code did not say. */
  pluginRoot: string | null;
  forceThrow: boolean;
  forceHang: boolean;
  /** Stall inside the cheap "is a seam project involved" check, which runs before anything else. */
  forceInertHang: boolean;
  /** How long the guard may take: 20 seconds, or less if a test asked for less. */
  timeoutMs: number;
}

/** The names of the environment variables the guard reads. */
const KEYS = ['CLAUDE_PLUGIN_DATA', 'CLAUDE_PLUGIN_ROOT', 'SEAM_TEST_FORCE_THROW', 'SEAM_TEST_FORCE_HANG', 'SEAM_TEST_FORCE_INERT_HANG', 'SEAM_TEST_TIMEOUT_MS'] as const;

/** The environment of this process. Handed to the guard, so a test can pass its own instead. */
export function currentEnv(): NodeJS.ProcessEnv {
  return process.env;
}

/** Only the variables the guard reads: what the hook hands to its worker thread. */
export function guardEnvVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const picked: NodeJS.ProcessEnv = {};
  for (const key of KEYS) if (env[key] !== undefined) picked[key] = env[key];
  return picked;
}

const text = (value: string | undefined): string | null => (value === undefined || value === '' ? null : value);

function limitFrom(value: string | undefined): number {
  const asked = Number(value);
  return Number.isInteger(asked) && asked >= 1 && asked < GUARD_TIMEOUT_MS ? asked : GUARD_TIMEOUT_MS;
}

/** What the guard needs from an environment (see GuardEnv). An empty value counts as not set. */
export function readGuardEnv(env: NodeJS.ProcessEnv): GuardEnv {
  return {
    dataDir: text(env.CLAUDE_PLUGIN_DATA),
    pluginRoot: text(env.CLAUDE_PLUGIN_ROOT),
    forceThrow: env.SEAM_TEST_FORCE_THROW === '1',
    forceHang: env.SEAM_TEST_FORCE_HANG === '1',
    forceInertHang: env.SEAM_TEST_FORCE_INERT_HANG === '1',
    timeoutMs: limitFrom(env.SEAM_TEST_TIMEOUT_MS),
  };
}
