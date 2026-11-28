// Rule 6 of decideCommand: a command may not name a path in a protected place, in any way it can be spelled. Every word
// is read every way a shell could read it (R20: MSYS, Cygwin and WSL drive forms, `~`, backslash escapes) and
// the stricter reading wins: if any reading is protected, the path is.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { classify, resolveReal } from '../lib/paths.ts';
import type { PathClass } from '../lib/paths.ts';
import type { Ctx } from '../types.ts';
import { attachedValues, pathParts, readingsOf, wordValue } from './commandtext.ts';
import { protectedPlace } from './commandwhy.ts';

/** Places a command may not name, not even as an argument of an allowed command. */
const OFF_LIMITS = new Set<PathClass>(['seam-records', 'plugin', 'data-dir', 'user-claude-config', 'claude-config']);
/** A path that starts `./` or `../` (or is `.` or `..`) is from the folder the command runs in, even after a ref. */
const FROM_HERE = /^\.\.?(?:[\\/]|$)/;

/** The top of the git repository the project is in: the nearest folder at or above its root that holds `.git`. */
function repoTop(root: string): string {
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return root;
  }
}

/**
 * The folders a word's path may be read from. Git reads the path in `ref:path` from the top of the repository
 * (`git show HEAD:.seam/state.json` is the same file from any folder in it; only `ref:./x` is from the folder the
 * command runs in), so a ref path is read from the top of the repository and from the project's root. Any other
 * path is from the folder the command runs in (R60).
 */
function basesOf(ref: boolean, text: string, cwd: string, ctx: Ctx): string[] {
  return ref && !FROM_HERE.test(text) ? [...new Set([repoTop(ctx.root), ctx.root])] : [cwd];
}

/**
 * The first word that names a path in a protected place, in any reading of it, as the refusal says it; null if none does.
 * The value stuck to a one-letter option counts as a path too (`-O.seam/x` is git reading an order file, R62, and so is
 * the one in a cluster, `-pO.claude/x`, R64).
 */
export function offLimits(words: string[], cwd: string, ctx: Ctx): string | null {
  for (const word of words) {
    for (const named of [word, ...attachedValues(word)]) {
      const parts = pathParts(named);
      if (parts === null) continue;
      for (const base of basesOf(parts.ref, parts.text, cwd, ctx)) {
        for (const reading of readingsOf(parts.text)) {
          const cls = classify(ctx, resolveReal(base, reading));
          if (OFF_LIMITS.has(cls)) return protectedPlace(word, cls);
        }
      }
    }
  }
  return null;
}

/**
 * Do any of these words write a path in a way the guard does not read as the place it names (R62)? `~+`, `~-` and `~name`
 * are other folders than the home folder; git's `:N:path` (the index at a stage) and `:/path` (from the top) and a path after
 * a ref that starts at a root (`HEAD:/x`) are written from somewhere else than the words say. Honest work does not need them.
 */
export function oddSpelling(words: string[]): boolean {
  return words.some((word) => {
    const value = wordValue(word) ?? '';
    const parts = pathParts(word);
    return /^~[^\\/]/.test(value) || /^:(?:[0-3]:|[\\/])/.test(value) || (parts !== null && parts.ref && /^[\\/]/.test(parts.text));
  });
}
