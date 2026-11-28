// Everything a decision needs, read once per hook run.
import { resolve } from 'node:path';
import { loadEnv } from '../formats/env.ts';
import { loadLock } from '../formats/lock.ts';
import { loadPlan } from '../formats/plan.ts';
import { readState } from '../lib/store.ts';
import type { Ctx } from '../types.ts';

/**
 * Load the state, plan, lock and setup of a project. Each throws a plain error if it is present but unreadable or invalid.
 * The app folder and the old app come from the plan; where the plan names none (there is no plan yet, its app folder is the default
 * `.`, it has no old app) they come from `.seam/env.json`, where `seam init --app-root` and `--legacy` put them (R80).
 */
export function buildCtx(root: string, dataDir: string, pluginRoot: string, now: Date): Ctx {
  const state = readState(root);
  const plan = loadPlan(root);
  const env = loadEnv(root);
  const appRoot = plan !== null && plan.appRoot !== '.' ? plan.appRoot : env?.appRoot ?? plan?.appRoot ?? '.';
  return { root, appRoot: resolve(root, appRoot), dataDir, pluginRoot, state, plan, lock: loadLock(root), now, legacyRoot: plan?.legacyRoot ?? env?.legacyRoot ?? null };
}
