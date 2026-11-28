// The app folder and the old app, as the plan and `.seam/env.json` give them together (R81). `seam init --app-root` and `--legacy` write the two
// folders to env.json, and the plan may name them too; where the plan keeps the default (`appRoot: "."`, no `legacyRoot`) the folder is env.json's.
// Everything that looks for the app's files (the guard's context, the lock, the freeze, the snapshot) goes through these, so they cannot
// disagree about where the app is. If the plan and env.json name two different folders nothing is guessed: it is refused, plainly.
import { posix } from 'node:path';
import { ENV_PATH } from '../formats/env.ts';
import type { SeamEnv } from '../formats/env.ts';
import { PLAN_PATH } from '../formats/plan.ts';
import type { Plan } from '../formats/plan.ts';

/** A folder as the plan and env.json compare it: forward slashes, no `./` in front, no slash at the end. The repo root is `.`. */
const tidy = (folder: string): string => posix.normalize(folder.replace(/\\/g, '/')).replace(/(.)\/+$/, '$1');

/** The refusal for two different folders: which two values disagree, and the two ways to make them agree. */
function disagree(what: string, key: 'appRoot' | 'legacyRoot', flag: string, fromPlan: string, fromEnv: string): Error {
  return new Error(
    `The plan (${PLAN_PATH}) says the ${what} is "${fromPlan}", but ${ENV_PATH} (from seam init ${flag}) says "${fromEnv}". ` +
    `They have to name the same folder: set "${key}" in ${PLAN_PATH} to "${fromEnv}", or change "${key}" in ${ENV_PATH} to "${fromPlan}".`,
  );
}

/** The app folder, from the repo root (`.` if it is the repo root). Throws, in plain words, if the plan and env.json name different ones. */
export function effectiveAppRoot(plan: Pick<Plan, 'appRoot'> | null, env: Pick<SeamEnv, 'appRoot'> | null): string {
  const fromPlan = tidy(plan?.appRoot ?? '.');
  const fromEnv = tidy(env?.appRoot ?? '.');
  if (fromPlan === '.' || fromPlan === fromEnv) return fromEnv === '.' ? fromPlan : fromEnv;
  if (fromEnv === '.') return fromPlan;
  throw disagree('app folder', 'appRoot', '--app-root', fromPlan, fromEnv);
}

/** The old app's folder, or null if there is none. Throws, in plain words, if the plan and env.json name different ones. */
export function effectiveLegacyRoot(plan: Pick<Plan, 'legacyRoot'> | null, env: Pick<SeamEnv, 'legacyRoot'> | null): string | null {
  const fromPlan = plan === null || plan.legacyRoot === null ? null : tidy(plan.legacyRoot);
  const fromEnv = env === null || env.legacyRoot === undefined ? null : tidy(env.legacyRoot);
  if (fromPlan === null || fromPlan === fromEnv) return fromEnv ?? fromPlan;
  if (fromEnv === null) return fromPlan;
  throw disagree('old app', 'legacyRoot', '--legacy', fromPlan, fromEnv);
}

/** The plan with both folders as they really are, so what reads `plan.appRoot` or `plan.legacyRoot` looks where the guard does. The same plan again if applied twice. */
export function withEffectiveRoots(plan: Plan, env: SeamEnv | null): Plan {
  return { ...plan, appRoot: effectiveAppRoot(plan, env), legacyRoot: effectiveLegacyRoot(plan, env) };
}
