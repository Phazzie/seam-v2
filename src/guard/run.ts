// `runHook`: everything the hook does with one request, as a function from the text Claude Code
// sent to the text it should print. It never throws and never allows by accident: whatever goes
// wrong (bad input, a crash, running out of time) comes out as a refusal. In a folder that is not a
// seam project it says nothing at all. (hook.ts reads stdin and prints; tests call this directly.)
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGuardEnv } from '../config/env.ts';
import type { GuardEnv } from '../config/env.ts';
import { touchHeartbeat } from '../lib/heartbeat.ts';
import { extendedPathProblem, isPathRefusal } from '../lib/pathcheck.ts';
import { roleOf } from '../lib/roles.ts';
import { recordBlock } from '../lib/store.ts';
import type { HookInput } from '../types.ts';
import { buildCtx } from './context.ts';
import { GUARD_TIMEOUT_MS, raceDeadline } from './deadline.ts';
import { decide } from './dispatch.ts';
import { hasUnreadablePath, parseInput, targetsOf } from './input.ts';
import { COULDNT_READ, describeError, internalError, RECORDS_MISSING, refusal, SILENT, TOOK_TOO_LONG } from './output.ts';
import type { HookEvent, HookOutput } from './output.ts';
import { resolveProject } from './project.ts';
import type { Found } from './project.ts';

/** One request being handled. `root` is set once the project is known, so a refusal can be recorded in it. */
interface Run {
  input: HookInput;
  event: HookEvent;
  env: GuardEnv;
  root: string | null;
}

/** Where to look for the project list when Claude Code gave no data folder: a folder that is never there. */
const NO_DATA_DIR = join(tmpdir(), 'seam-guard-no-data-folder');
const COMMAND_SNIPPET = 80;

/** What happened, for the log: `tried Write on src/a.ts: <reason>`. */
function whatHappened(run: Run, reason: string): string {
  const { input, event } = run;
  const [target] = targetsOf(input);
  const command = input.tool_input?.command;
  let where = '';
  if (target !== undefined) where = ` on ${target}`;
  else if (typeof command === 'string') where = ` "${command.slice(0, COMMAND_SNIPPET)}"`;
  const what = `${input.tool_name ?? 'a tool'}${where}`;
  return event === 'PostToolUse' ? `${what} left a problem: ${reason}` : `tried ${what}: ${reason}`;
}

/**
 * Refuse, and count it: every refusal in a seam project adds one to the block count and a line to the
 * log. If that cannot be done the refusal still stands, and says so after the reason.
 */
function deny(run: Run, reason: string, note?: string): HookOutput {
  let shown = reason;
  if (run.root !== null && run.env.dataDir !== null) {
    try {
      recordBlock(run.root, run.env.dataDir, roleOf(run.input), whatHappened(run, reason));
    } catch (err) {
      shown = `${reason} (this block could not be recorded: ${describeError(err)})`;
    }
  }
  return { ...refusal(run.event, shown), note };
}

/** The call is for a seam project: check in, make the checks that come before any decision, then decide. */
async function inSeamProject(run: Run, found: Extract<Found, { kind: 'seam' }>): Promise<HookOutput> {
  const { input, event, env } = run;
  run.root = found.root;
  const now = new Date();
  touchHeartbeat(found.root, now);
  if (found.problem !== null) return deny(run, found.problem);
  if (hasUnreadablePath(input)) return deny(run, COULDNT_READ, 'a path in tool_input is not text');
  for (const target of targetsOf(input)) {
    const problem = extendedPathProblem(target);
    if (problem !== null) return deny(run, problem);
  }
  if (env.dataDir === null || env.pluginRoot === null) {
    throw new Error('CLAUDE_PLUGIN_DATA or CLAUDE_PLUGIN_ROOT is not set, so the guard does not know where the plugin keeps its files');
  }
  if (env.forceThrow) throw new Error('SEAM_TEST_FORCE_THROW is set');
  if (env.forceHang) await new Promise<never>(() => undefined);
  const decision = await decide(input, event, buildCtx(found.root, env.dataDir, env.pluginRoot, now));
  return decision.kind === 'allow' ? SILENT : deny(run, decision.reason);
}

async function guarded(run: Run): Promise<HookOutput> {
  try {
    const found = resolveProject(run.input, run.env.dataDir ?? NO_DATA_DIR);
    if (found.kind === 'none') return SILENT;
    // With the records gone there is nowhere to count the block.
    if (found.kind === 'missing') return refusal(run.event, RECORDS_MISSING);
    return await inSeamProject(run, found);
  } catch (err) {
    return isPathRefusal(err) ? deny(run, err.message) : deny(run, internalError(err));
  }
}

/**
 * Handle one request. `raw` is what Claude Code sent on stdin and `env` the environment the hook runs
 * in. `timeoutMs` is how long the guard may take before it refuses for taking too long (20 seconds).
 */
export async function runHook(raw: string, env: NodeJS.ProcessEnv, timeoutMs: number = GUARD_TIMEOUT_MS): Promise<HookOutput> {
  const parsed = parseInput(raw);
  if (!parsed.ok) return { ...refusal(parsed.event, COULDNT_READ), note: `The request could not be read: ${parsed.why}` };
  const { input, event } = parsed;
  // A builder ends every turn by calling SubagentHandback (live check). The guard never stands in its way.
  if (event === null || input.tool_name === 'SubagentHandback') return SILENT;
  const run: Run = { input, event, env: readGuardEnv(env), root: null };
  return raceDeadline(() => guarded(run), timeoutMs, () => deny(run, TOOK_TOO_LONG));
}
