// Test helper: builds a throwaway seam project and runs the REAL bundled hook (dist/hook.mjs)
// against it as a child process, the way Claude Code does. Nothing here imports the guard.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadLock } from '../../src/formats/lock.ts';
import { loadPlan } from '../../src/formats/plan.ts';
import { loadState } from '../../src/formats/state.ts';
import type { SeamState } from '../../src/formats/state.ts';
import { snapshotProtected } from '../../src/guard/tamper.ts';
import { writeLock } from '../../src/lib/fingerprint.ts';
import { registerProject } from '../../src/lib/paths.ts';
import type { Ctx, HookInput, Phase } from '../../src/types.ts';
import { FIXTURE, skeleton } from './code.ts';
import { interpret, runNode } from './run.ts';
import type { HookResult, ProcResult } from './run.ts';
import { scratchDir } from './scratch.ts';

export type { HookResult, ProcResult };

const REPO = resolve(import.meta.dirname, '../..');
const HOOK = join(REPO, 'dist/hook.mjs');
const CLI = join(REPO, 'dist/seam.mjs');

/** The `agent_*` fields of a hook input: empty for the main agent. */
export type Who = Pick<HookInput, 'agent_id' | 'agent_type'>;
export const asMain = (): Who => ({});
export const asBuilder = (agentId: string): Who => ({ agent_id: agentId, agent_type: 'seam-v2:builder' });
export const asChecker = (agentId = 'checker-1'): Who => ({ agent_id: agentId, agent_type: 'seam-v2:checker' });

export interface AppOptions {
  phase: Phase;
  /** Extra files written into the app after the fixture is copied (relative path to text). */
  files?: Record<string, string>;
  /** Write skeletons for every planned file and `.seam/lock.json` (needs the Task 6 lock writer). */
  lock?: boolean;
  /** Take the protected-file snapshot (needs the Task 12 tamper module). Defaults to `lock`. */
  snapshot?: boolean;
  /** Whose turn it is: the builder's agent id and the file it owns. */
  turn?: { file: string; agentId: string };
}

export interface HookOptions {
  env?: Record<string, string>;
  /** Raw text to send on stdin instead of the JSON of the input. */
  stdin?: string;
  cwd?: string;
}

export interface App {
  root: string;
  dataDir: string;
  /** CLAUDE_PLUGIN_ROOT: a stand-in plugin folder holding a copy of dist/. */
  pluginRoot: string;
  abs(rel: string): string;
  hook(input: Partial<HookInput> & { hook_event_name: string }, opts?: HookOptions): Promise<HookResult>;
  /** Run `node dist/seam.mjs <args>` in the app with stdin piped, so it has no TTY. */
  cli(args: string[], opts?: { env?: Record<string, string> }): Promise<ProcResult>;
  read(rel: string): string;
  writeRaw(rel: string, text: string): void;
}

function put(base: string, rel: string, text: string): void {
  mkdirSync(dirname(join(base, rel)), { recursive: true });
  writeFileSync(join(base, rel), text);
}

/** The context the guard modules take, read back from what the app holds on disk. */
function ctxOf(root: string, dataDir: string, pluginRoot: string): Ctx {
  const state = loadState(root);
  const plan = loadPlan(root);
  if (!state || !plan) throw new Error('Test setup: the app has no state or plan.');
  return { root, appRoot: resolve(root, plan.appRoot), dataDir, pluginRoot, state, plan, lock: loadLock(root), now: new Date() };
}

export async function makeApp(opts: AppOptions): Promise<App> {
  const root = scratchDir('seam-app-');
  const dataDir = scratchDir('seam-data-');
  const pluginRoot = scratchDir('seam-plugin-');
  cpSync(FIXTURE, root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  // A stand-in plugin folder, so "a file under the plugin root" is a real file.
  cpSync(join(REPO, 'dist'), join(pluginRoot, 'dist'), { recursive: true });
  put(pluginRoot, '.claude-plugin/plugin.json', '{"name":"seam-v2"}\n');

  const turn = opts.turn ? { ...opts.turn, startedAt: new Date().toISOString() } : { agentId: null, file: null, startedAt: null };
  const state: SeamState = {
    version: 1, phase: opts.phase, turn, strikes: {}, parked: [], done: [], approvals: [], blocks: 0, halted: null,
  };
  put(root, '.seam/state.json', JSON.stringify(state, null, 2));
  put(root, '.seam/env.json', JSON.stringify({ dataDir }));
  registerProject(root, dataDir);
  for (const [rel, text] of Object.entries(opts.files ?? {})) put(root, rel, text);

  if (opts.lock) {
    const plan = loadPlan(root);
    if (!plan) throw new Error('Test setup: the app has no plan.');
    for (const seam of plan.seams) {
      for (const file of seam.files) {
        if (file.kind !== 'config' && !(file.path in (opts.files ?? {}))) put(root, file.path, skeleton(seam.id, file));
      }
    }
    writeLock(root, plan);
  }
  if (opts.snapshot ?? opts.lock) snapshotProtected(ctxOf(root, dataDir, pluginRoot));

  const env = (extra: Record<string, string> = {}, forCli = false): NodeJS.ProcessEnv => {
    // Nothing the developer's own shell has set (Claude Code's or a test switch) may leak in.
    const base: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(base)) if (/^(SEAM_TEST_|CLAUDE_)/i.test(key)) delete base[key];
    const ours = { CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_PLUGIN_ROOT: pluginRoot, ...(forCli ? { SEAM_DATA_DIR: dataDir } : {}) };
    return { ...base, ...ours, ...extra };
  };
  return {
    root,
    dataDir,
    pluginRoot,
    abs: (rel) => join(root, rel),
    hook: async (input, o = {}) => {
      const cwd = o.cwd ?? root;
      const stdin = o.stdin ?? JSON.stringify({ cwd, session_id: 'test-session', ...input });
      return interpret(await runNode(HOOK, [], stdin, cwd, env(o.env)));
    },
    cli: (args, o = {}) => runNode(CLI, args, '', root, env(o.env, true)),
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
    writeRaw: (rel, text) => put(root, rel, text),
  };
}
