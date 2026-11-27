// The plain sentences decideCommand refuses with. Each says why, and where there is something to do instead, what.
// None of them uses the phrase the guard's own failures carry ("blocked to be safe", Ruling R16): these are rules
// being applied.
import type { PathClass } from '../lib/paths.ts';
import { PROTECTED } from './writewhy.ts';

export const NOT_MAIN = 'only the main AI may run commands';
export const NO_COMMAND = "this call doesn't carry a command the guard can read";
export const CHAINING = 'one simple command at a time, please (these are not allowed: ; & | < > ` $ ( ) { } and line breaks)';
export const OPEN_QUOTE = 'one simple command at a time, please (a quote in it is never closed)';
export const BACKGROUND = "background runs aren't allowed";
export const APPROVE = "approvals happen only in the owner's approval window (the Seam Approve shortcut); the AI never runs seam approve";
export const NO_VERIFY = '--no-verify is not allowed: the git hooks always run';
export const NON_ASCII = 'plain ASCII only: other characters (curly quotes, non-breaking spaces and the like) are not allowed in a command, since they can hide what a word is';
export const POWERSHELL_COMMA = 'a comma is not allowed in a PowerShell command (it turns two words into one list); one simple command at a time, please';
export const BASH_BACKSLASH = 'a backslash before -, =, a quote or a space is not allowed in a Bash command (it hides what a word is); use plain words';
export const POWERSHELL_EXPAND = 'a %, a @ or --% is not allowed in a PowerShell command (they expand or re-split what follows)';
export const POWERSHELL_QUOTING =
  'a word with a space or a double quote, or a backslash at the end of a word or next to a quote, is not allowed in a PowerShell command (Windows PowerShell hands the program a different list of words; quote a word only around the whole of it)';
export const POWERSHELL_SPLITS =
  'PowerShell may split this option at the dot or colon; write it differently (a one-dash word like -p.x or -a:x can reach the program as two words, which the guard cannot check; use a double-dash option, or quote the whole word)';
export const POWERSHELL_EMPTY = 'an empty quoted word is not allowed in a PowerShell command (Windows PowerShell 5.1 drops it from the list of words)';
export const PATH_SPELLING = 'that way of writing a path (:N:path, :/path, ~+, ~-, ~name) is not allowed; name the file plainly';
export const TOO_LONG = 'this command is too long for the guard to check (over 200 words)';
export const WILDCARD = "wildcards (* ? [) are not allowed in a command's words; name the file or folder itself";
export const TESTS_NOT_HERE = 'tests run through the seam scripts in this phase';

/** The commands that are on the list, for the message that says one is not. */
const THE_LIST = 'seam report, seam status, seam request, seam init, seam install-shortcut, seam help';

export function protectedPlace(token: string, cls: PathClass): string {
  return `a command may not touch ${token}: ${PROTECTED[cls] ?? 'it is protected'}`;
}

/** Words that start something else (a shell, a script, code from text), where a hint to use the tools would mislead. */
const RUNS_CODE = /^(?:cmd|powershell|pwsh|bash|sh|zsh|env|iex|invoke-expression|invoke-command|icm|eval|exec|npx|node|python|python3|py)$/i;
const TOOLS_WRITE = /^(?:tee|sed|awk|cp|mv|rm|mkdir|touch|ln|del|erase|copy|move|ren|rename|rd|rmdir|md|mklink|ni|set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|clear-content|sc|ac)$/i;
const TOOLS_READ = /^(?:cat|ls|dir|gci|get-childitem|type|get-content|gc|head|tail|grep|rg|find|select-string|sls|pwd|which|where)$/i;
const NEEDS_INSTALL = /^(?:npm|npx|pnpm|yarn|bun|pip|pip3|pipx|winget|choco|brew|apt|apt-get)$/i;
const GIT_CHANGES = /^(?:commit|add|push|rm|mv|reset|checkout|switch|restore|merge|rebase|stash|tag|cherry-pick|revert|clean|apply|am)$/i;
const WITH_SUBCOMMAND = /^(?:git|npm|npx|pnpm|yarn|bun|pip|seam|node|cmd|powershell|pwsh|bash|sh|env)$/i;

/** What to do instead, for the needs that come up most; '' when there is nothing to add. */
function hintFor(words: string[]): string {
  const [first = '', second = ''] = words;
  if (/^git$/i.test(first)) return GIT_CHANGES.test(second) ? ' (committing arrives in stage 2 as `seam commit`)' : '';
  if (NEEDS_INSTALL.test(first) && /^(?:i|add|install|ci|update|upgrade|remove|uninstall)$/i.test(second)) {
    return ' (installing a package arrives in stage 2 as `seam add`)';
  }
  if (TOOLS_WRITE.test(first)) return ' (to change a file use the Edit and Write tools; only builders write app code)';
  if (TOOLS_READ.test(first)) return ' (to look at files use the Read, Glob and Grep tools)';
  if (RUNS_CODE.test(first)) return " (a command can't start another shell or run code from text)";
  return '';
}

/** `'git commit' isn't on seam's command list; ...`, with the first words as the AI wrote them. */
export function notOnList(words: string[]): string {
  const shown = (WITH_SUBCOMMAND.test(words[0] ?? '') ? words.slice(0, 2) : words.slice(0, 1)).join(' ');
  return `'${shown}' isn't on seam's command list; use the seam commands (${THE_LIST})${hintFor(words)}`;
}

/** An allowed program used in a way that is not allowed: it can write a file, run a program, or change something. */
export const wrongUse = (what: string, why: string): string => `'${what}' isn't allowed here: ${why}; use the seam commands (${THE_LIST})`;
