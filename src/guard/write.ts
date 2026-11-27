// decideWrite: who may write what, in which phase (the role table). Every Write, Edit, MultiEdit and
// NotebookEdit comes here. The order of the rules matters, and is the order of the checks below:
//   1. a protected place is refused for every role (a checker's verdict file is the one exception);
//   2. a path outside the repo that is not protected is not the guard's business;
//   3. a role that writes nothing is refused; node_modules and build output are refused (R19);
//   4. a code file that is not in the plan is refused, whoever writes it (cheat 6);
//   5. then the main AI's rules (planning files, contracts, tests) or the builder's (turn, lock, code rules).
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { errorCode } from '../lib/atomic.ts';
import { isScriptPath } from '../lib/lockfiles.ts';
import { checkAgainstLock } from '../lib/lockcheck.ts';
import { classify, inBuildOutput, rel, resolveReal } from '../lib/paths.ts';
import type { PathClass } from '../lib/paths.ts';
import { roleOf } from '../lib/roles.ts';
import { codeRuleProblems, contractProblems } from '../lib/rules.ts';
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

function decideContract(input: HookInput, ctx: Ctx, t: Target): Decision {
  const { phase } = ctx.state;
  if (phase !== 'plan2') return deny(why.contractsFrozen(phase));
  if (!isScriptPath(t.name)) return ALLOW; // a data file holds no code to hide
  const proposed = proposedContent(input, currentText(input, t.real));
  if (!proposed.ok) return deny(proposed.reason);
  const problems = contractProblems(proposed.text);
  return problems.length === 0 ? ALLOW : deny(why.refusal(t.name, problems, []));
}

function decideMain(input: HookInput, ctx: Ctx, t: Target): Decision {
  const { phase } = ctx.state;
  switch (t.cls) {
    case 'plan': return PLANNING.has(phase) ? ALLOW : deny(why.planFrozen(phase));
    case 'contracts': return decideContract(input, ctx, t);
    case 'tests': return phase === 'tests' ? ALLOW : deny(why.testsFrozen(phase));
    case 'app-code': return deny(why.ONLY_BUILDERS);
    default: return ALLOW; // docs, notes, README, git-ignored scratch: not code
  }
}

function decideBuilder(input: HookInput, ctx: Ctx, t: Target): Decision {
  const { phase, turn } = ctx.state;
  if (phase !== 'build') return deny(why.buildOnly(phase));
  const itsTurn = input.agent_id === turn.agentId && turn.file !== null && resolveReal(ctx.root, turn.file) === t.real;
  if (!itsTurn) return deny(why.notYourTurn(t.name));
  if (ctx.lock === null || ctx.plan === null) return deny(why.NO_LOCK);
  const proposed = proposedContent(input, currentText(input, t.real));
  if (!proposed.ok) return deny(proposed.reason);
  // The lock's keys are from the repo root; the rule about src/config/ is from the app folder.
  const lockProblems = checkAgainstLock(t.name, proposed.text, ctx.lock, ctx.plan);
  const ruleProblems = codeRuleProblems(t.inApp ?? t.name, proposed.text);
  return lockProblems.length + ruleProblems.length === 0 ? ALLOW : deny(why.refusal(t.name, lockProblems, ruleProblems));
}

function decideFile(input: HookInput, ctx: Ctx, t: Target): Decision {
  const role = roleOf(input);
  const protectedPlace = why.PROTECTED[t.cls];
  if (protectedPlace !== undefined) return role === 'checker' && t.inRepo !== null && VERDICT.test(t.inRepo) ? ALLOW : deny(protectedPlace);
  if (t.cls === 'outside') return ALLOW;
  const writesNothing = why.READS_ONLY[role];
  if (writesNothing !== undefined) return deny(writesNothing);
  if (t.cls === 'ignored' && t.inRepo !== null && inBuildOutput(t.inRepo, t.inApp)) return deny(why.IN_BUILD_OUTPUT);
  if (t.cls === 'app-code' && t.planned === null) return deny(why.notInPlan(t.name));
  return role === 'main' ? decideMain(input, ctx, t) : decideBuilder(input, ctx, t); // only these two are left
}

/** May this tool call write what it names? A refusal says why, in plain words. */
export function decideWrite(input: HookInput, ctx: Ctx): Decision {
  const named = targetsOf(input);
  if (named.length === 0) return deny(why.NO_FILE);
  for (const written of named) {
    const decision = decideFile(input, ctx, targetOf(input, ctx, written));
    if (decision.kind === 'deny') return decision;
  }
  return ALLOW;
}
