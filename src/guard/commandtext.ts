// A shell command read as plain text (no file system): its words, and the paths and folders it names. The
// hook's project lookup (request.ts, which has to stay small and cheap) and decideCommand both use it, so both
// see the same paths (R41). It does not understand the shell. It reads too much on purpose, and a word that is
// not really a path only costs a look.
import { homedir } from 'node:os';
import { join } from 'node:path';

/** What ends one command and starts the next, or redirects. The words either side of one are in different segments. */
const SEPARATORS = new Set([';', '&', '|', '<', '>', '(', ')', '{', '}', '`', '\n', '\r']);
/** Programs that change folder: the word after one is a folder, whether or not it looks like a path (R41). */
const CD_WORDS = new Set(['cd', 'chdir', 'pushd', 'sl', 'set-location', 'push-location']);
const DRIVE = /^[a-z]:/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** `/c/x`, `/cygdrive/c/x` and `/mnt/c/x`: how MSYS, Cygwin and WSL write `C:/x` (R20). A bare `/c` is cmd's switch, not a drive. */
const MSYS = /^\/(?:(?:cygdrive|mnt)\/([a-z])|([a-z])(?=\/))(?:\/(.*))?$/i;

/** The words of a command, one list per simple command, and whether every quote was closed. */
export interface Scanned {
  segments: string[][];
  closed: boolean;
}

/**
 * Split a command into words. Quotes group and are dropped, as a shell does, so `.se''am` is `.seam`. With `blind`
 * a quote is only a word break, which reads inside quotes too: `"$(cd /proj)"` runs its `cd` although it is quoted.
 */
export function scan(command: string, blind = false): Scanned {
  const segments: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: string | null = null;
  const endWord = (): void => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endSegment = (): void => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      if (blind) endWord();
      else {
        quote = ch;
        inWord = true;
      }
    } else if (SEPARATORS.has(ch)) {
      endSegment();
    } else if (ch === ' ' || ch === '\t') {
      endWord();
    } else {
      word += ch;
      inWord = true;
    }
  }
  endSegment();
  return { segments, closed: quote === null };
}

/**
 * The part of a word that can be a path: an option's value (`--output=x`, `-Path:x`) or the word itself, minus a
 * git ref in front (`HEAD:src/a.ts` names `src/a.ts`). Null for an option without a value, a web address, one of
 * cmd's switches (`/c`), or nothing but separators.
 */
export function pathText(word: string): string | null {
  let text = word;
  if (text.startsWith('-')) {
    const value = /^-{1,2}[^=:\s]+[=:](.*)$/.exec(text)?.[1];
    if (value === undefined) return null;
    text = value;
  }
  if (SCHEME.test(text) || /^\/[a-z?]$/i.test(text)) return null;
  if (!DRIVE.test(text) && text.includes(':')) text = text.slice(text.lastIndexOf(':') + 1);
  return text === '' || /^[\\/]+$/.test(text) ? null : text;
}

/** Does it look like a path (and so is worth a look when nothing says it is one)? */
export const isPathLike = (text: string): boolean => /[\\/]/.test(text) || /^[.~]/.test(text) || DRIVE.test(text);

/**
 * Every way a shell could read this path: as written; with backslashes taken as escapes (the way bash reads
 * them, but not in a drive path, which is written with them); with MSYS, Cygwin and WSL drive forms made drive paths (R20); and with `~` as the home folder. A
 * guard that must not miss a protected path asks about all of them and takes the stricter answer.
 */
export function readingsOf(text: string): string[] {
  const readings = new Set([text]);
  if (!DRIVE.test(text)) readings.add(text.replace(/\\(.)/g, '$1')); // a drive path with backslashes is meant as one
  const msys = MSYS.exec(text);
  if (msys !== null) readings.add(`${(msys[1] ?? msys[2]).toUpperCase()}:/${msys[3] ?? ''}`);
  if (/^~(?:[\\/]|$)/.test(text)) readings.add(join(homedir(), text.slice(1)));
  return [...readings];
}

/**
 * The paths a command names, and the folders it changes into (`cd`, `pushd`, `Set-Location`), each in every
 * reading (readingsOf). Read twice, with quotes grouping words and without, so nothing hides in a quote. Only
 * text that looks like a path counts, apart from the word after a folder change.
 */
export function commandTargets(command: string): string[] {
  const found = new Set<string>();
  for (const blind of [false, true]) {
    for (const words of scan(command, blind).segments) {
      let changing = false;
      for (const word of words) {
        if (CD_WORDS.has(word.toLowerCase())) {
          changing = true;
          continue;
        }
        const text = pathText(word);
        if (text === null) continue; // an option: a pending folder change waits for its target
        if (changing || isPathLike(text)) readingsOf(text).forEach((reading) => found.add(reading));
        changing = false;
      }
    }
  }
  return [...found];
}
