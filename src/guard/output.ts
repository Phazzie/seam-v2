// What the hook prints, and the plain sentences it says when it fails closed. Every sentence that
// means "the guard could not decide, so it refused" contains "blocked to be safe" (Ruling R16),
// and no sentence that applies a rule does.

export type HookEvent = 'PreToolUse' | 'PostToolUse';

/** What the hook process prints and exits with. */
export interface HookOutput {
  stdout: string;
  exitCode: number;
  /** For the owner's debug output (stderr): the real cause when the reason shown to the model is brief. */
  note?: string;
}

/** Nothing to say: the guard stays out of the way. */
export const SILENT: HookOutput = { stdout: '', exitCode: 0 };

export const COULDNT_READ = "seam guard couldn't read the request, so it was blocked to be safe";
export const TOOK_TOO_LONG = 'seam guard took too long to decide, so it was blocked to be safe';
export const TWO_PROJECTS = 'this action touches two seam projects; blocked to be safe';
export const RECORDS_MISSING = "this seam project's records (.seam) are missing; ask the owner";

/** The words of whatever was thrown (it is not always an Error). */
export const describeError = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function internalError(err: unknown): string {
  return `seam guard hit an internal error and blocked to be safe: ${describeError(err)}`;
}

/**
 * Claude Code's words for "no": a PreToolUse deny stops the tool before it runs; a PostToolUse
 * block tells the model the tool's result is not acceptable. The guard never prints "allow".
 */
export function refusal(event: HookEvent, reason: string): HookOutput {
  const body =
    event === 'PostToolUse'
      ? { decision: 'block', reason }
      : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  return { stdout: JSON.stringify(body), exitCode: 0 };
}
