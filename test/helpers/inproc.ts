// Runs the hook's `runHook` in this process, so the unit tests can see inside it (what it recorded,
// which decision it called). The cheat tests, and the cold-start checks, run the real bundle instead.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput } from '../../src/types.ts';
import { runHook } from '../../src/guard/run.ts';
import type { HookOutput } from '../../src/guard/output.ts';
import type { App } from './app.ts';

type Input = Partial<HookInput> & { hook_event_name: string };

/** The environment Claude Code gives the hook for this app, plus any extras (the SEAM_TEST_* switches). */
export function envFor(app: App, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { CLAUDE_PLUGIN_DATA: app.dataDir, CLAUDE_PLUGIN_ROOT: app.pluginRoot, ...extra };
}

export interface CallOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
}

/** Send one request to `runHook` as if Claude Code had, from `opts.cwd` (the app's folder by default). */
export function call(app: App, input: Input, opts: CallOptions = {}): Promise<HookOutput> {
  const raw = JSON.stringify({ cwd: opts.cwd ?? app.root, session_id: 'test-session', ...input });
  return runHook(raw, opts.env ?? envFor(app), opts.timeoutMs);
}

/** What the hook printed, as JSON. */
export const printed = (out: HookOutput): unknown => JSON.parse(out.stdout);

/** The reason in a refusal, whichever of the two shapes it is in. */
export function reasonOf(out: HookOutput): string {
  const body = printed(out) as { reason?: string; hookSpecificOutput?: { permissionDecisionReason?: string } };
  return body.hookSpecificOutput?.permissionDecisionReason ?? body.reason ?? '';
}

/** How many blocks the app has recorded. */
export const blocksOf = (app: App): number => (JSON.parse(app.read('.seam/state.json')) as { blocks: number }).blocks;

/** The plain log, or '' if nothing was logged. */
export const logOf = (root: string): string => (existsSync(join(root, '.seam/log.md')) ? readFileSync(join(root, '.seam/log.md'), 'utf8') : '');

/** Has a hook run checked in at this project? */
export const heartbeatSeen = (root: string): boolean => existsSync(join(root, '.seam/heartbeat.json'));
