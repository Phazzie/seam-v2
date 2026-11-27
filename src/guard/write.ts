// decideWrite: who may write what, in which phase (the role table). Every Write, Edit, MultiEdit and
// NotebookEdit comes here. The order of the rules matters, and is the order of the checks below:
//   1. a protected place is refused for every role (a checker's verdict file is the one exception);
//   2. a role that writes nothing (describer, surveyor, readonly, design, and a checker apart from its
//      verdict) is refused everywhere, outside the repo too (R48);
//   3. outside the repo, and not protected, only the main AI may write (R48);
//   4. node_modules and build output are refused (R19);
//   5. a code file that is not in the plan is refused, whoever writes it (cheat 6);
//   6. then the main AI's rules (planning files, contracts, tests) or the builder's (turn, lock, code rules).
// The TypeScript parser is heavy (about half a second to load), so the modules that use it are loaded with
// `import()` only at the two places that need them: a builder's code write and a main-AI contract write
// (R47). Everything decided by the kind of path, the phase or the turn never loads it.
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { errorCode } from '../lib/atomic.ts';
import { classify, inBuildOutput, rel, resolveReal } from '../lib/paths.ts';
import type { PathClass } from '../lib/paths.ts';
import { roleOf } from '../lib/roles.ts';
import type { Ctx, Decision, HookInput, Phase } from '../types.ts';
import { proposedContent } from './proposed.ts';
import { targetsOf } from './request.ts';
import * as why from './writewhy.ts';

export { proposedContent } from './proposed.ts';
export type { Proposed } from './proposed.ts';

const ALLOW: Decision = { kind: 'allow' };
const deny = (reason: string): Decision => ({ kind: 'deny', reason });

const PLANNING = new Set<Phase>(['setup', 'survey', 'plan1', 'plan2']);
/** A checker's one file: `.seam/verdicts/<name>.json`, straight inside that folder. */
const VERDICT = /^\.seam\/verdicts\/[^/]+\.json$/;
/** The only kind of file in `contracts/` (R49). */
const TYPESCRIPT = /\.ts$/i;

/** A file a write names: where it really is, and what it is to the guard. */
interface Target {
  /** As the AI wrote it. */
  written: string;
  /** The real, canonical absolute path. */
  real: string;
  /** From the repo root (lower case on Windows), or null outside the repo. */
  inRepo: string | null;
  /** From the app folder, or null when it is not inside it. */
  inApp: string | null;
  cls: PathClass;
  /** The plan's spelling of it, as the lock keys it (from the repo root), or null if the plan doesn't list it. */
  planned: string | null;
  /** What messages call it: the plan's spelling if there is one, else its path from the repo root. */
  name: string;
}

/** The plan's spelling of the file at `inRepo`, or null if the plan doesn't list it (the plan's paths may be from the app folder or the repo). */
function plannedAs(ctx: Ctx, inRepo: string | null): string | null {
  if (inRepo === null) return null;
  const root = resolveReal(ctx.root, '.');
  for (const file of ctx.plan?.seams.flatMap((seam) => seam.files) ?? []) {
    for (const base of [ctx.appRoot, ctx.root]) {
      const abs = resolve(base, file.path);
      if (rel(root, abs) === inRepo) return relative(ctx.root, abs).replace(/\\/g, '/');
    }
  }
  return null;
}

function targetOf(input: HookInput, ctx: Ctx, written: string): Target {
  const real = resolveReal(input.cwd, written);
  const root = resolveReal(ctx.root, '.');
  const inRepo = rel(root, real);
  const inApp = rel(resolveReal(root, ctx.appRoot || '.'), real);
  const planned = plannedAs(ctx, inRepo);
  return { written, real, inRepo, inApp, cls: classify(ctx, real), planned, name: planned ?? inRepo ?? written };
}

/** What is on disk now, for an Edit to work on; null if there is no such file. A Write does not need it. */
function currentText(input: HookInput, real: string): string | null {
  if (input.tool_name === 'Write') return null;
  try {
    return readFileSync(real, 'utf8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT' || errorCode(err) === 'ENOTDIR') return null;
    throw err;
  }
}

/** A contract: only in plan2, only a `.ts` file (R49), and no function in it. The parser is loaded here and nowhere before. */
async function decideContract(input: HookInput, ctx: Ctx, t: Target): Promise<Decision> {
  const { phase } = ctx.state;
  if (phase !== 'plan2') return deny(why.contractsFrozen(phase));
  if (!TYPESCRIPT.test(t.name)) return deny(why.CONTRACTS_TS_ONLY);
  const proposed = proposedContent(input, currentText(input, t.real));
  if (!proposed.ok) return deny(proposed.reason);
  const { contractProblems } = await import('../lib/rules.ts');
  const problems = contractProblems(proposed.text);
  return problems.length === 0 ? ALLOW : deny(why.refusal(t.name, problems, []));
}

function decideMain(input: HookInput, ctx: Ctx, t: Target): Promise<Decision> | Decision {
  const { phase } = ctx.state;
  switch (t.cls) {
    case 'plan': return PLANNING.has(phase) ? ALLOW : deny(why.planFrozen(phase));
    case 'contracts': return decideContract(input, ctx, t);
    case 'tests': return phase === 'tests' ? ALLOW : deny(why.testsFrozen(phase));
    case 'app-code': return deny(why.ONLY_BUILDERS);
    default: return ALLOW; // docs, notes, README, git-ignored scratch: not code
  }
}

/** A builder: in the build phase, on its turn, for its file, with a text that keeps the lock and the code rules. */
async function decideBuilder(input: HookInput, ctx: Ctx, t: Target): Promise<Decision> {
  const { phase, turn } = ctx.state;
  if (phase !== 'build') return deny(why.buildOnly(phase));
  const itsTurn = input.agent_id === turn.agentId && turn.file !== null && resolveReal(ctx.root, turn.file) === t.real;
  if (!itsTurn) return deny(why.notYourTurn(t.name));
  if (ctx.lock === null || ctx.plan === null) return deny(why.NO_LOCK);
  const proposed = proposedContent(input, currentText(input, t.real));
  if (!proposed.ok) return deny(proposed.reason);
  const [{ checkAgainstLock }, { codeRuleProblems }] = await Promise.all([import('../lib/lockcheck.ts'), import('../lib/rules.ts')]);
  // The lock's keys are from the repo root; the rule about src/config/ is from the app folder.
  const lockProblems = checkAgainstLock(t.name, proposed.text, ctx.lock, ctx.plan);
  const ruleProblems = codeRuleProblems(t.inApp ?? t.name, proposed.text);
  return lockProblems.length + ruleProblems.length === 0 ? ALLOW : deny(why.refusal(t.name, lockProblems, ruleProblems));
}

async function decideFile(input: HookInput, ctx: Ctx, t: Target): Promise<Decision> {
  const role = roleOf(input);
  const protectedPlace = why.PROTECTED[t.cls];
  if (protectedPlace !== undefined) return role === 'checker' && t.inRepo !== null && VERDICT.test(t.inRepo) ? ALLOW : deny(protectedPlace);
  const writesNothing = why.READS_ONLY[role];
  if (writesNothing !== undefined) return deny(writesNothing);
  // Only main and builder are left.
  if (t.cls === 'outside') return role === 'main' ? ALLOW : deny(why.OUTSIDE_MAIN_ONLY);
  if (t.cls === 'ignored' && t.inRepo !== null && inBuildOutput(t.inRepo, t.inApp)) return deny(why.IN_BUILD_OUTPUT);
  if (t.cls === 'app-code' && t.planned === null) return deny(why.notInPlan(t.name));
  return role === 'main' ? decideMain(input, ctx, t) : decideBuilder(input, ctx, t);
}

/** May this tool call write what it names? A refusal says why, in plain words. */
export async function decideWrite(input: HookInput, ctx: Ctx): Promise<Decision> {
  const named = targetsOf(input);
  if (named.length === 0) return deny(why.NO_FILE);
  for (const written of named) {
    const decision = await decideFile(input, ctx, targetOf(input, ctx, written));
    if (decision.kind === 'deny') return decision;
  }
  return ALLOW;
}
