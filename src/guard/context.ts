// Everything a decision needs, read once per hook run.
import { resolve } from 'node:path';
import { loadLock } from '../formats/lock.ts';
import { loadPlan } from '../formats/plan.ts';
import { readState } from '../lib/store.ts';
import type { Ctx } from '../types.ts';

/** Load the state, plan and lock of a project. Each throws a plain error if it is present but unreadable or invalid. */
export function buildCtx(root: string, dataDir: string, pluginRoot: string, now: Date): Ctx {
  const state = readState(root);
  const plan = loadPlan(root);
  return { root, appRoot: resolve(root, plan?.appRoot ?? '.'), dataDir, pluginRoot, state, plan, lock: loadLock(root), now };
}
