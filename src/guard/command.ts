// decideCommand: which shell commands may run. Shell commands are the widest door, so the rule is an allowlist:
// one simple command from a short list, and only the main AI runs it. The order of the checks is the order below:
//   1. any role but the main AI is refused;
//   2. a mention of `approve` next to `seam`, or of `--no-verify`, is refused (only the owner approves);
//   3. a background run is refused, in every spelling (a trailing `&`, Start-Process as the command, nohup, run_in_background);
//   4. chaining, redirection, substitution, script blocks and line breaks are refused: one simple command;
//      A word that starts with `#` is refused here too (R76): it is a comment to the shell and arguments to the guard;
//   5. so is anything that makes the words the guard sees differ from the words the shell passes on (R56): a character
//      that is not ASCII (non-breaking spaces and curly quotes are word breaks and quotes to PowerShell), a comma in
//      PowerShell (it joins words into one list), a backslash before `-`, `=`, a quote or a space in Bash (it is
//      removed, so `\--output` is `--output`); in PowerShell (5.1 quotes a word with a space badly, R61) a space or `"` in a
//      word, a backslash at the end of a word or by a quote, `%` (also `--%`) and `@`; and a command of more than 200 words,
//      which is not checked word by word;
//   6. then the allowlist (commandrules.ts); anything not on it is refused, with what to do instead. Tests run only in
//      the build and flip phases (R59);
//   7. the words of an allowed command may not hold a wildcard (`* ? [`, R60: `.se?m` is `.seam`) or a path written
//      another way than it reads (`~+`, `:N:path`, `:/path`, R62), and a path in a
//      protected place is refused (commandpaths.ts). A refused command is told about its protected paths first.
// What a command names also decides which seam project it belongs to (R41, in request.ts), so a command run
// from outside a project that changes into one is judged by that project.
import { roleOf } from '../lib/roles.ts';
import type { Ctx, Decision, HookInput } from '../types.ts';
import { oddSpelling, offLimits } from './commandpaths.ts';
import { judge } from './commandrules.ts';
import { scan } from './commandtext.ts';
import * as why from './commandwhy.ts';

export { commandTargets } from './commandtext.ts';

const ALLOW: Decision = { kind: 'allow' };
const deny = (reason: string): Decision => ({ kind: 'deny', reason });

/** The most words the guard checks one by one (R60). */
const MAX_WORDS = 200;

/** Chaining and redirection (`; & | < >`), substitution (a backtick, `$`), groups and script blocks (`( ) { }`), line breaks and control characters. */
const NOT_SIMPLE = /[;&|<>`(){}$\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** What the Bash tool takes out before a program sees a word: a backslash before `-`, `=`, a quote, a space, or at the end of a word. */
const BASH_ESCAPE = /\\(?:[-='" \t]|$)/;
/** Programs that start something that outlives the command, as the command (R60: a test called `disown.test.ts` is not one). */
const BACKGROUND_COMMAND = /^(?:start-process|saps|start-job|sajb|start-threadjob|nohup|setsid|disown)$/i;
/** Spellings that mean a background run wherever they are: `start /b`, a hidden window, a trailing `&` (not `&&`). */
const BACKGROUND_SPELLING = /\bstart\s+\/b\b|-WindowStyle\s+Hidden|(?<!&)&\s*$/i;

/** The Bash and PowerShell tools can also ask to run in the background with a field instead of a spelling. */
const asksBackground = (toolInput: Record<string, unknown> | undefined): boolean => {
  const asked = toolInput?.run_in_background;
  return asked !== undefined && asked !== null && asked !== false;
};

/**
 * Does a word of the command start with `#`, outside quotes? The shell (Bash and PowerShell both) reads it, and all that follows it,
 * as a comment, which the guard's word-by-word reading would take for arguments (R76: `git branch injected # --list` runs
 * `git branch injected`). A `#` inside a word, or inside quotes, is only a character.
 */
function startsComment(command: string): boolean {
  let quote: string | null = null;
  let atStart = true;
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      atStart = false;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      atStart = false;
    } else if (ch === ' ' || ch === '\t') {
      atStart = true;
    } else {
      if (ch === '#' && atStart) return true;
      atStart = false;
    }
  }
  return false;
}

/** A quote next to a backslash in the text of a command: Windows PowerShell does not escape a quote it puts around a word, so `\"` ends the word early. */
const QUOTE_AND_BACKSLASH = /\\['"]|['"]\\/;
/**
 * A piece of a command between blanks that Windows PowerShell 5.1 reads as one word the way the guard does: no quote at all,
 * or one quote at each end and none inside. It splits `'a'--output=x` into `a` and `--output=x`, where the guard sees one word.
 */
const ONE_WORD_TO_POWERSHELL = /^(?:[^'"]*|'[^'"]*'|"[^'"]*")$/;
/**
 * An unquoted word that starts with one dash (R64): Windows PowerShell 5.1 reads it as a parameter name and ends it at a `.`,
 * so `-pp.seam/x` reaches the program as `-pp` and `.seam/x`. A word that starts with two dashes, or is quoted, is passed whole.
 * A re-review measured what splits on 5.1: only a `.` and a `[`. A `:` does NOT split (`-a:--output=x` reaches the program
 * whole), but the `:` is refused here as well. That is harmless (a plain command has no `:` in a one-dash word) and keeps the
 * rule from depending on which characters a PowerShell version splits at. The `[` split is not matched here: a `[` in any
 * word of an allowed command is already refused as a wildcard (step 7 in the list at the top of this file, `why.WILDCARD`).
 */
const SPLIT_BY_POWERSHELL = /^-(?!-)[^'"]*[.:]/;

/**
 * Windows PowerShell 5.1 (the PowerShell tool) hands a program its words with the old quoting (R61): a word that holds a
 * space is wrapped in double quotes without escaping what is inside, so a `"` or a backslash at its end splits it into
 * more words than the guard saw, and so does a quote closed in front of more text; `--%` splits what follows again and
 * expands `%VAR%`; `@name` splats. None of it is needed for plain commands, so a word with a space or a `"`, a quote that
 * is not around a whole word, a backslash at the end of a word or by a quote, any `%` and any `@` is refused; so is an
 * unquoted one-dash word with a `.` or `:` in it (PowerShell splits at the `.`, and the `:` is refused with it, R64), and an
 * empty quoted word (PowerShell drops it).
 */
function powershellProblem(command: string, words: string[]): string | null {
  if (command.includes(',')) return why.POWERSHELL_COMMA;
  if (/[%@]/.test(command)) return why.POWERSHELL_EXPAND;
  if (QUOTE_AND_BACKSLASH.test(command) || words.some((word) => /[\s"]/.test(word) || word.endsWith('\\'))) return why.POWERSHELL_QUOTING;
  const pieces = command.split(/[ \t]+/);
  if (pieces.some((piece) => !ONE_WORD_TO_POWERSHELL.test(piece))) return why.POWERSHELL_QUOTING;
  if (pieces.some((piece) => SPLIT_BY_POWERSHELL.test(piece))) return why.POWERSHELL_SPLITS;
  if (words.includes('')) return why.POWERSHELL_EMPTY; // '' and "" are dropped
  return null;
}

/** Why the words of this command may not be trusted to be the words the shell passes on (R56, R61), or null. */
function misleading(tool: string | undefined, command: string, words: string[]): string | null {
  if (/[^\u0000-\u007f]/.test(command)) return why.NON_ASCII;
  if (tool === 'PowerShell') return powershellProblem(command, words);
  if (tool === 'Bash' && BASH_ESCAPE.test(command)) return why.BASH_BACKSLASH;
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
  const background = asksBackground(input.tool_input) || BACKGROUND_SPELLING.test(command) || segments.some(([first]) => BACKGROUND_COMMAND.test(first));
  if (background) return deny(why.BACKGROUND);
  if (NOT_SIMPLE.test(command) || segments.length !== 1) return deny(why.CHAINING);
  if (startsComment(command)) return deny(why.COMMENTS);
  const unsafe = misleading(input.tool_name, command, segments[0]);
  if (unsafe !== null) return deny(unsafe);
  if (!closed) return deny(why.OPEN_QUOTE);
  if (segments[0].length > MAX_WORDS) return deny(why.TOO_LONG);
  const judged = judge(segments[0], input.cwd, ctx);
  if (judged.ok && judged.args.some((arg) => /[*?[]/.test(arg))) return deny(why.WILDCARD);
  if (judged.ok && oddSpelling(judged.args)) return deny(why.PATH_SPELLING);
  const touched = offLimits(judged.args, input.cwd, ctx);
  if (touched !== null) return deny(touched);
  return judged.ok ? ALLOW : deny(judged.reason);
}
