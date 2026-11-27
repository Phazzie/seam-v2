// Test helper for the tamper check: the guard's context for an app made by makeApp, the checks run in this
// process (so a test can look inside), and what the check keeps in the data folder.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCtx } from '../../src/guard/context.ts';
import { decide } from '../../src/guard/dispatch.ts';
import { checkTamper } from '../../src/guard/tamper.ts';
import { readState } from '../../src/lib/store.ts';
import { rootKey } from '../../src/lib/store.ts';
import type { Ctx, Decision, HookInput } from '../../src/types.ts';
import type { App } from './app.ts';
import { logOf } from './inproc.ts';

type Input = Partial<HookInput> & { hook_event_name: string };

/** The context the hook would build for this app right now (state, plan and lock as they are on disk). */
export const ctxOf = (app: App): Ctx => buildCtx(app.root, app.dataDir, app.pluginRoot, new Date());

/** Run the tamper check for a PostToolUse input, as the hook does, and give its problems. */
export const problemsOf = async (app: App, input: Input): Promise<string[]> => (await checkTamper({ cwd: app.root, ...input } as HookInput, ctxOf(app))).problems;

/** What the check keeps for this project in the data folder. */
export const recordDir = (app: App): string => join(app.dataDir, 'mirror', rootKey(app.root));

export interface Saved { files: Record<string, { hash: string; size: number; mtimeMs: number }>; code: string[]; unattributed: number }
export const recordOf = (app: App): Saved => JSON.parse(readFileSync(join(recordDir(app), 'protected.json'), 'utf8')) as Saved;

/** The folders of moved-aside files, and every file in them (paths below the folder of its own timestamp). */
export function quarantined(app: App): string[] {
  const base = join(app.dataDir, 'quarantine');
  if (!existsSync(base)) return [];
  return readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(base.length + 1).split(/[\\/]/).slice(1).join('/'));
}

export const stateOf = (app: App): ReturnType<typeof readState> => readState(app.root);
export const logText = (app: App): string => logOf(app.root);

/** The hook's decision for an input (PreToolUse or PostToolUse, as the input says), in this process. */
export const decideFor = (app: App, input: Input): Promise<Decision> =>
  decide({ cwd: app.root, ...input } as HookInput, input.hook_event_name === 'PostToolUse' ? 'PostToolUse' : 'PreToolUse', ctxOf(app));

/** The plan with one more package, so it still parses: the kind of change that gets through a plan check and is still a tamper. */
export const longerPlan = (app: App): string => app.read('plan/plan.json').replace('"packages": ["react"]', '"packages": ["react", "zod"]');
/** The plan with one letter different, so its size is the same as before. */
export const samePlan = (app: App): string => app.read('plan/plan.json').replace('"packages": ["react"]', '"packages": ["reakt"]');
