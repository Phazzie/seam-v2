// `runHook`: everything the guard does with one request, as a function from the text Claude Code
// sent to the text it should print. It never throws and never allows by accident: whatever goes
// wrong (bad input, a crash, running out of time) comes out as a refusal. In a folder that is not a
// seam project it says nothing at all.
//
// The real hook does not call this on its main thread: it runs it in a worker thread, so that work
// which never gives the thread back can still be cut off (see supervisor.ts). Tests call it directly.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGuardEnv } from '../config/env.ts';
import type { GuardEnv } from '../config/env.ts';
import { touchHeartbeat } from '../lib/heartbeat.ts';
import { extendedPathProblem, isPathRefusal, staysOnNetwork, streamPathProblem } from '../lib/pathcheck.ts';
import type { HookInput } from '../types.ts';
import { buildCtx } from './context.ts';
import { raceDeadline } from './deadline.ts';
import { decide } from './dispatch.ts';
import { COULDNT_READ, internalError, RECORDS_MISSING, refusal, SILENT, TOOK_TOO_LONG } from './output.ts';
import type { HookEvent, HookOutput } from './output.ts';
import { resolveProject } from './project.ts';
import type { Found } from './project.ts';
import { recordRefusal } from './record.ts';
import { hasUnreadablePath, prepare, targetsOf } from './request.ts';

/** Ways to run `runHook` differently, for the worker and for tests. */
export interface RunOptions {
  /** How long the guard may take before it refuses for taking too long. Defaults to what the environment allows. */
  timeoutMs?: number;
  /** What SEAM_TEST_FORCE_HANG does. Defaults to waiting forever without using the thread; the worker busy-loops. */
  stall?: () => Promise<never>;
  /** Told the project's root as soon as it is known, so a refusal can be counted even if the guard never answers. */
  onProject?: (root: string) => void;
}

/** One request being handled. `root` is set once the project is known, so a refusal can be recorded in it. */
interface Run {
  input: HookInput;
  event: HookEvent;
  env: GuardEnv;
  root: string | null;
  options: RunOptions;
}

/** Where to look for the project list when Claude Code gave no data folder: a folder that is never there. */
const NO_DATA_DIR = join(tmpdir(), 'seam-guard-no-data-folder');
/** Why a block is not counted when the data folder is on the network: the count is mirrored there. */
const NOT_ON_NETWORK = 'this block was not recorded: the plugin data folder is on the network, which the guard does not write to';
const waitForever = (): Promise<never> => new Promise<never>(() => undefined);

/**
 * Refuse, and count it: every refusal in a seam project adds one to the block count and a line to the
 * log. If that cannot be done the refusal still stands, and says so after the reason.
 */
function deny(run: Run, reason: string, note?: string): HookOutput {
  let shown = reason;
  if (run.root !== null && run.env.dataDir !== null) {
    const failed = staysOnNetwork(run.env.dataDir) ? NOT_ON_NETWORK : recordRefusal(run.root, run.env.dataDir, run.input, run.event, reason);
    if (failed !== '') shown = `${reason} (${failed})`;
  }
  return { ...refusal(run.event, shown), note };
}

/** The call is for a seam project: check in, make the checks that come before any decision, then decide. */
async function inSeamProject(run: Run, found: Extract<Found, { kind: 'seam' }>): Promise<HookOutput> {
  const { input, event, env } = run;
  run.root = found.root;
  run.options.onProject?.(found.root);
  const now = new Date();
  touchHeartbeat(found.root, now);
  if (found.problem !== null) return deny(run, found.problem);
  if (hasUnreadablePath(input)) return deny(run, COULDNT_READ, 'a path in tool_input is not text');
  for (const target of targetsOf(input)) {
    const problem = extendedPathProblem(target) ?? streamPathProblem(target);
    if (problem !== null) return deny(run, problem);
  }
  if (env.dataDir === null || env.pluginRoot === null) {
    throw new Error('CLAUDE_PLUGIN_DATA or CLAUDE_PLUGIN_ROOT is not set, so the guard does not know where the plugin keeps its files');
  }
  // A data folder on the network is a doubt (R46): checking paths against it would ask its host, and so would counting the block.
  if (staysOnNetwork(env.dataDir)) {
    throw new Error(`CLAUDE_PLUGIN_DATA (${env.dataDir}) is a network path, which the guard does not look at, so it does not know where the plugin keeps its files`);
  }
  if (env.forceThrow) throw new Error('SEAM_TEST_FORCE_THROW is set');
  if (env.forceHang) await (run.options.stall ?? waitForever)();
  const decision = await decide(input, event, buildCtx(found.root, env.dataDir, env.pluginRoot, now));
  return decision.kind === 'allow' ? SILENT : deny(run, decision.reason);
}

async function guarded(run: Run): Promise<HookOutput> {
  try {
    const found = resolveProject(run.input, run.env.dataDir ?? NO_DATA_DIR);
    if (found.kind === 'none') {
      return found.doubt === undefined ? SILENT : { ...SILENT, note: `a path could not be checked (${found.doubt}), so the call was left alone as not part of a seam project` };
    }
    // With the records gone there is nowhere to count the block.
    if (found.kind === 'missing') return refusal(run.event, RECORDS_MISSING);
    return await inSeamProject(run, found);
  } catch (err) {
    return isPathRefusal(err) ? deny(run, err.message) : deny(run, internalError(err));
  }
}

/**
 * Handle one request. `raw` is what Claude Code sent on stdin and `env` the environment the hook runs
 * in (see `RunOptions` for the rest).
 */
export async function runHook(raw: string, env: NodeJS.ProcessEnv, options: RunOptions = {}): Promise<HookOutput> {
  const ready = prepare(raw);
  if ('done' in ready) return ready.done;
  const guardEnv = readGuardEnv(env);
  const run: Run = { input: ready.input, event: ready.event, env: guardEnv, root: null, options };
  return raceDeadline(() => guarded(run), options.timeoutMs ?? guardEnv.timeoutMs, () => deny(run, TOOK_TOO_LONG));
}
