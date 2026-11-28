// The commands that may run, and how each may be used (rule 5 of decideCommand). Anything else is refused. Each
// answer also says which words decideCommand must still check for protected paths: all of them for a command that
// is refused, the arguments after the command for one that is allowed.
import { resolveReal } from '../lib/paths.ts';
import type { Ctx, Phase } from '../types.ts';
import { unescaped } from './commandtext.ts';
import { notOnList, TESTS_NOT_HERE, wrongUse } from './commandwhy.ts';

export type Judged = { ok: true; args: string[] } | { ok: false; reason: string; args: string[] };

const SEAM_SUBS = new Set(['report', 'status', 'request', 'init', 'install-shortcut', 'help']);
const GIT_READS = new Set(['status', 'log', 'diff', 'show']);
const RUNS_SOMETHING = 'that option can write a file or run a program';
/** Long git options that are refused, and why. Git takes any start of a long option, so any start of one of these is refused too. */
const GIT_REFUSED: readonly (readonly [string, string])[] = [
  ['output', RUNS_SOMETHING],
  ['ext-diff', RUNS_SOMETHING],
  ['textconv', RUNS_SOMETHING],
  ['no-index', 'that option reads files outside git; the Read tool is for that'],
];
/** What `git branch` may be asked: to list. Every other option (-d -D -m -M -c -C -f -u --set-upstream-to ...) creates, renames or deletes. */
const BRANCH_LONG = new Set([
  'all', 'remotes', 'verbose', 'list', 'show-current', 'merged', 'no-merged', 'contains', 'no-contains', 'sort', 'format',
  'color', 'no-color', 'column', 'no-column', 'ignore-case', 'points-at', 'abbrev', 'no-abbrev',
]);
const BRANCH_SHORT = new Set(['a', 'r', 'v', 'i']);
/** Listing options that take a value, which is the next word when it is not written `--name=value` (git tried: a word after `--format x` makes a branch). */
const BRANCH_VALUE = new Set(['sort', 'format', 'points-at']);
/** The same, but git takes the next word as the value only if there is one and it is not `--` (`--contains` alone means `--contains HEAD`). */
const BRANCH_VALUE_OR_DEFAULT = new Set(['contains', 'no-contains', 'merged', 'no-merged']);

/** The words as the shell passes them on, and with the backslash escapes taken out (`--out\put` is `--output`): an option check asks about both (R56). */
export const readings = (words: string[]): string[][] => [words, words.map(unescaped)];

const ok = (args: string[]): Judged => ({ ok: true, args });
const refuse = (reason: string, args: string[]): Judged => ({ ok: false, reason, args });

/** `seam <sub> ...`: only the listed subcommands. */
function seamCommand(sub: string | undefined, args: string[]): Judged {
  if (sub !== undefined && SEAM_SUBS.has(sub.toLowerCase())) return ok(args);
  return refuse(wrongUse(`seam ${sub ?? ''}`.trim(), 'that is not one of the seam commands'), [...(sub === undefined ? [] : [sub]), ...args]);
}

/** Is this word the plugin's own `dist/seam.mjs`? Compared as paths from the session's folder, so `./dist/seam.mjs` counts from the plugin folder only. */
const isSeamScript = (word: string, cwd: string, ctx: Ctx): boolean => resolveReal(cwd, word) === resolveReal(ctx.pluginRoot, 'dist/seam.mjs');

/** `node --version`, or `node <plugin>/dist/seam.mjs <sub>`: never node with a flag or a script of its own. */
function nodeCommand(words: string[], cwd: string, ctx: Ctx): Judged {
  const [, script, sub, ...args] = words;
  if (words.length === 2 && script === '--version') return ok([]);
  if (script !== undefined && isSeamScript(script, cwd, ctx)) return seamCommand(sub, args);
  return refuse(notOnList(words), words);
}

/** The first refused option (a long one, or `-L`, R62), with the reason; null if there is none. After a lone `--` the words are paths. */
function refusedOption(args: string[]): { arg: string; why: string } | null {
  for (const arg of args) {
    if (arg === '--') return null;
    if (/^-[A-Za-z0-9]*L/.test(arg)) return { arg, why: 'that option names a line range and a file in a way the guard cannot read as a place' };
    const name = arg.startsWith('--') ? arg.slice(2).split('=')[0] : '';
    const found = name === '' ? undefined : GIT_REFUSED.find(([long]) => long.startsWith(name));
    if (found !== undefined) return { arg, why: found[1] };
  }
  return null;
}

/**
 * What is wrong with these `git branch` words, if anything: an option that is not for listing, or a word that would make or
 * rename a branch. The words are read as git reads them (R76): a value an option takes is consumed with it, so it is not mistaken
 * for a name, and a word that is not any option's value is a branch name and is refused, whatever else is on the line. `--column`,
 * `--color` and `--abbrev` take a value only written `--column=x`: a word after one of them is a name.
 */
function branchProblem(args: string[]): string | null {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    if (arg === '--') return args[at + 1] ?? null; // everything after it is a name
    if (arg.startsWith('--')) {
      const [long, ...attached] = arg.slice(2).split('=');
      if (!BRANCH_LONG.has(long)) return arg;
      const next = args[at + 1];
      const takes = BRANCH_VALUE.has(long) || (BRANCH_VALUE_OR_DEFAULT.has(long) && next !== undefined && next !== '--');
      if (attached.length === 0 && takes) at += 1; // the next word is this option's value
    } else if (arg.startsWith('-') && arg !== '-') {
      if ([...arg.slice(1)].some((letter) => !BRANCH_SHORT.has(letter))) return arg;
    } else {
      return arg;
    }
  }
  return null;
}

/** `git status|log|diff|show|branch`, read-only: nothing that writes a file or runs a program, and `branch` only lists. */
function gitCommand(words: string[]): Judged {
  const [, verb = '', ...args] = words;
  const name = verb.toLowerCase();
  if (name !== 'branch' && !GIT_READS.has(name)) return refuse(notOnList(words), words);
  for (const asPassed of readings(args)) {
    if (name === 'branch') {
      const bad = branchProblem(asPassed);
      if (bad !== null) return refuse(wrongUse(`git branch ${bad}`, 'git branch only lists branches; it must not make, rename or delete one'), words);
    } else {
      const bad = refusedOption(asPassed);
      if (bad !== null) return refuse(wrongUse(`git ${verb} ${bad.arg}`, bad.why), words);
    }
  }
  return ok(args);
}

const same = (words: string[], form: string[]): boolean => words.length === form.length && words.every((word, i) => word.toLowerCase() === form[i]);
/** Tests are written, then frozen; there is something to run them on only from the build on (R59). */
const TEST_PHASES = new Set<Phase>(['build', 'flip']);
const testsMayRun = (ctx: Ctx): boolean => TEST_PHASES.has(ctx.state.phase);

/** `npm test` and `npm run test` (build and flip only, R59), `npm run typecheck` and `npm --version` (any phase): nothing added, since an option can change what runs. */
function npmCommand(words: string[], ctx: Ctx): Judged {
  const rest = words.slice(1);
  if (same(rest, ['run', 'typecheck']) || same(rest, ['--version'])) return ok([]);
  if (same(rest, ['test']) || same(rest, ['run', 'test'])) return testsMayRun(ctx) ? ok([]) : refuse(TESTS_NOT_HERE, []);
  const [head = '', next = ''] = rest.map((word) => word.toLowerCase());
  const listed = head === 'test' || (head === 'run' && (next === 'test' || next === 'typecheck'));
  return refuse(listed ? wrongUse(words.join(' '), 'npm test and npm run typecheck take nothing added; npx vitest run <path> runs one test file') : notOnList(words), words);
}

/** `npx vitest run [path ...]` (build and flip only, R59): paths only, because an option such as --config or --reporter can load code. */
function npxCommand(words: string[], ctx: Ctx): Judged {
  const [, tool, verb, ...args] = words;
  if (tool?.toLowerCase() !== 'vitest' || verb?.toLowerCase() !== 'run') return refuse(notOnList(words), words);
  if (!testsMayRun(ctx)) return refuse(TESTS_NOT_HERE, []);
  const option = readings(args).flat().find((arg) => arg.startsWith('-'));
  return option === undefined ? ok(args) : refuse(wrongUse(`npx vitest run ${option}`, 'it takes test file paths only; an option can load code'), words);
}

/** May this command run? `words` are its words (quotes taken off), `cwd` is where it runs. */
export function judge(words: string[], cwd: string, ctx: Ctx): Judged {
  switch ((words[0] ?? '').toLowerCase()) {
    case 'seam': return seamCommand(words[1], words.slice(2));
    case 'node': return nodeCommand(words, cwd, ctx);
    case 'git': return gitCommand(words);
    case 'npm': return npmCommand(words, ctx);
    case 'npx': return npxCommand(words, ctx);
    default: return refuse(notOnList(words), words);
  }
}
