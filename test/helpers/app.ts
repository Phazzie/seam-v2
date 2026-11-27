// Test helper: builds a throwaway seam project and runs the REAL bundled hook (dist/hook.mjs)
// against it as a child process, the way Claude Code does. Nothing here imports the guard.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll } from 'vitest';
import { loadLock } from '../../src/formats/lock.ts';
import { loadPlan } from '../../src/formats/plan.ts';
import { loadState } from '../../src/formats/state.ts';
import type { SeamState } from '../../src/formats/state.ts';
import { snapshotProtected } from '../../src/guard/tamper.ts';
import { writeLock } from '../../src/lib/fingerprint.ts';
import type { Ctx, HookInput, Phase } from '../../src/types.ts';
import { FIXTURE, skeleton } from './code.ts';

const REPO = resolve(import.meta.dirname, '../..');
const HOOK = join(REPO, 'dist/hook.mjs');
const CLI = join(REPO, 'dist/seam.mjs');
/** A hook that has not answered by now is dead; the guard's own limit is 20 s. */
const KILL_AFTER_MS = 27_000;

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

export interface HookResult {
  /** `permissionDecision: "deny"` in the output, or exit code 2. */
  denied: boolean;
  /** `decision: "block"` in the output. */
  blocked: boolean;
  reason: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  ms: number;
}

export interface HookOptions {
  env?: Record<string, string>;
  /** Raw text to send on stdin instead of the JSON of the input. */
  stdin?: string;
  cwd?: string;
}

export interface ProcResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
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

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

function tempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

function put(base: string, rel: string, text: string): void {
  mkdirSync(dirname(join(base, rel)), { recursive: true });
  writeFileSync(join(base, rel), text);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse hook output. Empty or non-JSON output means "no decision", so it gives `{}`. */
function parseOutput(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function runNode(script: string, args: string[], stdin: string, cwd: string, env: NodeJS.ProcessEnv): Promise<ProcResult> {
  return new Promise((done, fail) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk));
    // A process that exits without reading all of stdin closes the pipe; that is not a test error.
    child.stdin.on('error', () => {});
    const timer = setTimeout(() => child.kill(), KILL_AFTER_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      fail(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ stdout, stderr, exitCode: code ?? -1, ms: Date.now() - started });
    });
    child.stdin.end(stdin);
  });
}

function interpret(run: ProcResult): HookResult {
  const out = parseOutput(run.stdout);
  const specific = isRecord(out.hookSpecificOutput) ? out.hookSpecificOutput : {};
  const denyByJson = specific.permissionDecision === 'deny';
  const blocked = out.decision === 'block';
  const said = denyByJson ? specific.permissionDecisionReason : blocked ? out.reason : run.exitCode === 2 ? run.stderr : '';
  return { denied: denyByJson || run.exitCode === 2, blocked, reason: String(said ?? '').trim(), ...run };
}

/** The context the guard modules take, read back from what the app holds on disk. */
function ctxOf(root: string, dataDir: string, pluginRoot: string): Ctx {
  const state = loadState(root);
  const plan = loadPlan(root);
  if (!state || !plan) throw new Error('Test setup: the app has no state or plan.');
  return { root, appRoot: resolve(root, plan.appRoot), dataDir, pluginRoot, state, plan, lock: loadLock(root), now: new Date() };
}

export async function makeApp(opts: AppOptions): Promise<App> {
  const root = tempDir('seam-app-');
  const dataDir = tempDir('seam-data-');
  const pluginRoot = tempDir('seam-plugin-');
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
  // Task 4's registerProject replaces this hand-written registry entry.
  put(dataDir, 'projects.json', JSON.stringify({ projects: [root.replace(/\\/g, '/')] }));
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
    const base: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_PLUGIN_ROOT: pluginRoot };
    for (const key of Object.keys(base)) if (key.startsWith('SEAM_TEST_')) delete base[key];
    return { ...base, ...(forCli ? { SEAM_DATA_DIR: dataDir } : {}), ...extra };
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
