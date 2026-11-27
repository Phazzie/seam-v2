// What a path is to the guard: which protected place it sits in, or plain app code. Every write,
// command and read decision starts here, so the answer must not depend on how the path was spelled.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, isAbsolute, posix, resolve } from 'node:path';
import type { Ctx } from '../types.ts';
import { rel, resolveReal, tidyPart } from './realpath.ts';

export type PathClass =
  | 'seam-records' | 'claude-config' | 'user-claude-config' | 'plugin' | 'data-dir' | 'legacy' | 'plan'
  | 'contracts' | 'tests' | 'fixtures' | 'config-file' | 'app-code' | 'generated' | 'ignored'
  | 'other-in-repo' | 'outside';

/** `package.json`, `tsconfig*.json`, `vitest.config.*` and the like, plus `.gitignore` (what it lists decides what counts as code). */
const CONFIG_NAME = /^(?:package(?:-lock)?\.json|tsconfig.*\.json|(?:vitest|vite|eslint)\.config\..+|\.gitignore)$/i;
/** Folders only a build tool writes, when they sit at the top of the repo or the app. */
const OUTPUT_DIRS = new Set(['dist', '.next', '.nuxt', '.output', '.svelte-kit', '.turbo', '.vercel', 'coverage', '.vite', '.parcel-cache']);
const TEST_DIRS = new Set(['tests', 'test']);

/** Is `relPath` a file the build rules treat as code? (`.json` and `.sql` count, except under `probes/` and `.seam/`.) */
export function isCodeFile(relPath: string): boolean {
  const parts = posix.normalize(relPath.replace(/\\/g, '/')).split('/').map(tidyPart).filter((part) => part !== '');
  const path = parts.join('/').toLowerCase();
  if (/\.(?:tsx?|jsx?|mjs|cjs)$/.test(path)) return true;
  return /\.(?:json|sql)$/.test(path) && !/^(?:probes|\.seam)\//.test(path);
}

/** A repo-relative path seen from one base folder (the repo root, or the app folder if that is elsewhere). */
interface View { base: string; rel: string }

const first = (path: string): string => path.split('/')[0];
const hasFirst = (views: View[], names: Set<string> | string): boolean =>
  views.some((v) => (typeof names === 'string' ? first(v.rel) === names : names.has(first(v.rel))));
/** Does one of the listed plan paths (a file, or a folder and everything in it) cover this path? */
const covered = (views: View[], entries: readonly string[]): boolean =>
  entries.some((entry) => views.some((v) => {
    const listedAs = rel(v.base, resolve(v.base, entry));
    return listedAs !== null && listedAs !== '' && (v.rel === listedAs || v.rel.startsWith(`${listedAs}/`));
  }));
const insideDir = (dir: string, p: string): boolean => dir !== '' && rel(resolveReal(dir, dir), p) !== null;

const ignoreAnswers = new Map<string, boolean>();

/**
 * Does a `.gitignore` inside the repo ignore this path? Asked of git once per path and kept for the
 * rest of the run. Ignore rules from git's private exclude file or the user's global ignore file do
 * not count, because the AI can edit those without the repo noticing. A folder that is not a git
 * repo, or any git failure, counts as "not ignored", which keeps the path guarded.
 */
function gitIgnores(root: string, relPath: string): boolean {
  const key = `${root}\n${relPath}`;
  const known = ignoreAnswers.get(key);
  if (known !== undefined) return known;
  const run = spawnSync('git', ['check-ignore', '-v', '--', relPath], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  // `source:line:pattern<TAB>path`. Exit 1 is "not ignored"; 128 is "not a repo" or another git failure.
  const match = run.status === 0 ? /^((?:[a-z]:)?[^:]*):\d+:(.*)\t/i.exec(run.stdout) : null;
  const ignored = match !== null && !isAbsolute(match[1]) && basename(match[1]) === '.gitignore' && !match[2].startsWith('!');
  ignoreAnswers.set(key, ignored);
  return ignored;
}

/** The part of a user's Claude config the guard protects: settings files and plugins. */
function isUserClaudeConfig(p: string): boolean {
  const inside = rel(resolveReal(homedir(), '.claude'), p);
  return inside !== null && (/^settings[^/]*\.json$/i.test(inside) || /^plugins(?:\/|$)/i.test(inside));
}

/**
 * Which kind of path `absPath` is. It resolves the path itself (see resolveReal), so a spelling the
 * caller did not clean up is judged by where it really points. The first matching rule wins.
 */
export function classify(ctx: Ctx, absPath: string): PathClass {
  const root = resolveReal(ctx.root, ctx.root);
  const p = resolveReal(root, absPath);
  if (insideDir(ctx.dataDir, p)) return 'data-dir';
  if (insideDir(ctx.pluginRoot, p)) return 'plugin';
  if (isUserClaudeConfig(p)) return 'user-claude-config';
  const inRepo = rel(root, p);
  if (inRepo === null) return 'outside';

  const appDir = resolveReal(root, ctx.appRoot || root);
  const inApp = rel(appDir, p);
  const views: View[] = [{ base: root, rel: inRepo }];
  if (inApp !== null && appDir !== root) views.push({ base: appDir, rel: inApp });
  const plan = ctx.plan;

  if (first(inRepo) === '.seam') return 'seam-records';
  if (hasFirst(views, '.claude')) return 'claude-config';
  if (first(inRepo) === 'plan') return 'plan';
  if (plan?.legacyRoot != null) {
    const old = resolveReal(root, plan.legacyRoot);
    // The new app may live inside the old tree (old app at the repo root, new one in seam-app/).
    const appInsideOld = appDir !== old && rel(old, appDir) !== null;
    if (rel(old, p) !== null && !(appInsideOld && inApp !== null)) return 'legacy';
  }
  if (inRepo.split('/').includes('node_modules') || hasFirst(views, OUTPUT_DIRS)) return 'ignored';
  if (hasFirst(views, TEST_DIRS)) return 'tests';
  if (hasFirst(views, 'contracts')) return 'contracts';
  if (hasFirst(views, 'fixtures') || views.some((v) => /^probes\/fixtures(?:\/|$)/.test(v.rel))) return 'fixtures';
  if (covered(views, plan?.generated ?? [])) return 'generated';
  // `.git/` holds git's own settings, hooks and exclude list: all of them can change what counts as code.
  if (CONFIG_NAME.test(basename(inRepo)) || hasFirst(views, '.git') || covered(views, plan?.config ?? [])) return 'config-file';
  if (gitIgnores(root, inRepo)) return 'ignored';
  return isCodeFile(inApp ?? inRepo) ? 'app-code' : 'other-in-repo';
}
