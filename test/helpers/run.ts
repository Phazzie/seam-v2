// Runs a script as a child process, the way Claude Code runs a hook, and reads what the hook
// printed. Nothing here imports the guard. Problems that are not a decision (a broken pipe,
// output that is not JSON) are recorded on the result so a test can report them.
import { spawn } from 'node:child_process';

/** A hook that has not answered by now is dead; the guard's own limit is 20 s. */
const KILL_AFTER_MS = 27_000;

export interface ProcResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
  /** Set when writing to the process's stdin failed (usually it exited without reading it all). */
  stdinError: string;
}

export interface HookResult extends ProcResult {
  /** `permissionDecision: "deny"` in the output, or exit code 2. */
  denied: boolean;
  /** `decision: "block"` in the output. */
  blocked: boolean;
  reason: string;
  /** Set when stdout had text that was not a JSON object. A hook must print JSON or nothing. */
  outputError: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse hook output. Empty output is "no decision"; text that is not a JSON object is an error. */
function parseOutput(text: string): { value: Record<string, unknown>; error: string } {
  if (text.trim() === '') return { value: {}, error: '' };
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? { value, error: '' } : { value: {}, error: 'stdout was JSON but not an object' };
  } catch (err) {
    return { value: {}, error: `stdout was not JSON (${(err as Error).message})` };
  }
}

export function runNode(script: string, args: string[], stdin: string, cwd: string, env: NodeJS.ProcessEnv): Promise<ProcResult> {
  return new Promise((done, fail) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let stdinError = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk));
    child.stdin.on('error', (err) => {
      stdinError = err.message;
    });
    const timer = setTimeout(() => child.kill(), KILL_AFTER_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      fail(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ stdout, stderr, exitCode: code ?? -1, ms: Date.now() - started, stdinError });
    });
    child.stdin.end(stdin);
  });
}

/**
 * Turn a finished hook run into what Claude Code would act on. A crash (any other non-zero exit)
 * is neither denied nor blocked, because Claude Code lets the action through. The guard never
 * says "allow", so output that does is a bug and throws, which fails the test that triggered it.
 */
export function interpret(run: ProcResult): HookResult {
  const { value: out, error } = parseOutput(run.stdout);
  const specific = isRecord(out.hookSpecificOutput) ? out.hookSpecificOutput : {};
  if (specific.permissionDecision === 'allow') {
    throw new Error(`The hook printed permissionDecision "allow"; the guard may only deny or stay silent. Output: ${run.stdout}`);
  }
  const denyByJson = specific.permissionDecision === 'deny';
  const blocked = out.decision === 'block';
  const said = denyByJson ? specific.permissionDecisionReason : blocked ? out.reason : run.exitCode === 2 ? run.stderr : '';
  return { ...run, denied: denyByJson || run.exitCode === 2, blocked, reason: String(said ?? '').trim(), outputError: error };
}
