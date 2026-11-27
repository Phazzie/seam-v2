// decideCommand: which shell commands may run. Shell commands are the widest door, so the rule is an allowlist:
// one simple command from a short list, and only the main AI runs it. The order of the checks is the order below:
//   1. any role but the main AI is refused;
//   2. a mention of `approve` next to `seam`, or of `--no-verify`, is refused (only the owner approves);
//   3. a background run is refused, in every spelling (a trailing `&`, Start-Process, nohup, run_in_background);
//   4. chaining, redirection, substitution, script blocks and line breaks are refused: one simple command;
//   5. a path in a protected place is refused. A path is read every way a shell could (R20): `/c/x`, `/mnt/c/x`
//      and `/cygdrive/c/x` as `C:/x`, `~` as home, backslashes as escapes; if any reading is protected it is;
//   6. then the allowlist (commandrules.ts); anything not on it is refused, with what to do instead.
// What a command names also decides which seam project it belongs to (R41, in request.ts), so a command run
// from outside a project that changes into one is judged by that project.
import { classify, resolveReal } from '../lib/paths.ts';
import type { PathClass } from '../lib/paths.ts';
import { roleOf } from '../lib/roles.ts';
import type { Ctx, Decision, HookInput } from '../types.ts';
import { judge } from './commandrules.ts';
import { pathText, readingsOf, scan } from './commandtext.ts';
import * as why from './commandwhy.ts';

export { commandTargets } from './commandtext.ts';

const ALLOW: Decision = { kind: 'allow' };
const deny = (reason: string): Decision => ({ kind: 'deny', reason });

/** Places a command may not name, not even as an argument of an allowed command. */
const OFF_LIMITS = new Set<PathClass>(['seam-records', 'plugin', 'data-dir', 'user-claude-config', 'claude-config']);

/** Chaining and redirection (`; & | < >`), substitution (a backtick, `$`), groups and script blocks (`( ) { }`), line breaks and control characters. */
const NOT_SIMPLE = /[;&|<>`(){}$\r\n\u2028\u2029\u0085\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** Ways to start something that outlives the command: a program, a job, a hidden window, or a trailing `&` (not `&&`). */
const BACKGROUND = /\b(?:start-process|saps|start-job|sajb|start-threadjob|nohup|setsid|disown)\b|\bstart\s+\/b\b|-WindowStyle\s+Hidden|(?<!&)&\s*$/i;

/** The Bash and PowerShell tools can also ask to run in the background with a field instead of a spelling. */
const asksBackground = (toolInput: Record<string, unknown> | undefined): boolean => {
  const asked = toolInput?.run_in_background;
  return asked !== undefined && asked !== null && asked !== false;
};

/** The first word that names a path in a protected place, in any reading of it, as the refusal says it. */
function offLimits(words: string[], cwd: string, ctx: Ctx): string | null {
  for (const word of words) {
    const text = pathText(word);
    if (text === null) continue;
    for (const reading of readingsOf(text)) {
      const cls = classify(ctx, resolveReal(cwd, reading));
      if (OFF_LIMITS.has(cls)) return why.protectedPlace(word, cls);
    }
  }
  return null;
}

/** May this Bash or PowerShell call run? A refusal says why, and what to do instead. */
export function decideCommand(input: HookInput, ctx: Ctx): Decision {
  if (roleOf(input) !== 'main') return deny(why.NOT_MAIN);
  const command = input.tool_input?.command;
  if (typeof command !== 'string' || command.trim() === '') return deny(why.NO_COMMAND);
  const { segments, closed } = scan(command);
  // Looked for in what was typed and in the words once the quotes are off (`appr''ove` is `approve`).
  const said = `${command}\n${segments.flat().join(' ')}`;
  if (/\bapprove\b/i.test(said) && /\bseam\b/i.test(said)) return deny(why.APPROVE);
  if (/--no-verify\b/i.test(said)) return deny(why.NO_VERIFY);
  if (asksBackground(input.tool_input) || BACKGROUND.test(command)) return deny(why.BACKGROUND);
  if (NOT_SIMPLE.test(command) || segments.length !== 1) return deny(why.CHAINING);
  if (!closed) return deny(why.OPEN_QUOTE);
  const judged = judge(segments[0], input.cwd, ctx);
  const touched = offLimits(judged.args, input.cwd, ctx);
  if (touched !== null) return deny(touched);
  return judged.ok ? ALLOW : deny(judged.reason);
}
