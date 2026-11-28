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

/**
 * `package.json`, `tsconfig*.json`, `vitest.config.*` and the like, plus `.gitignore` (what it lists decides what counts as
 * code), and the files that make a tool run code or read its settings from the repo (R52): `.npmrc`, `.yarnrc`,
 * `.yarnrc.yml`, `.babelrc`, `.babelrc.*`, `babel.config.*`, `.swcrc`, `.env`, `.env.*`, `.nvmrc`, `.node-version`, `.tool-versions`.
 */
const CONFIG_NAME = /^(?:package(?:-lock)?\.json|tsconfig.*\.json|(?:vitest|vite|eslint)\.config\..+|\.gitignore|\.npmrc|\.yarnrc(?:\.yml)?|\.babelrc(?:\..+)?|babel\.config\..+|\.swcrc|\.env(?:\..+)?|\.nvmrc|\.node-version|\.tool-versions)$/i;
/** Folders only a build tool writes, when they sit at the top of the repo or the app (and `node_modules` anywhere). */
const OUTPUT_DIRS = new Set(['dist', '.next', '.nuxt', '.output', '.svelte-kit', '.turbo', '.vercel', 'coverage', '.vite', '.parcel-cache']);
const TEST_DIRS = new Set(['tests', 'test']);

/** Is `relPath` a file the build rules treat as code? (`.ts .tsx .js .jsx .mjs .cjs .mts .cts`; `.json` and `.sql` count, except under `probes/` and `.seam/`.) */
export function isCodeFile(relPath: string): boolean {
  const parts = posix.normalize(relPath.replace(/\\/g, '/')).split('/').map(tidyPart).filter((part) => part !== '');
  const path = parts.join('/').toLowerCase();
  if (/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) return true;
  return /\.(?:json|sql)$/.test(path) && !/^(?:probes|\.seam)\//.test(path);
}

/** A repo-relative path seen from one base folder (the repo root, or the app folder if that is elsewhere). */
interface View { base: string; rel: string }

const first = (path: string): string => path.split('/')[0];
const hasFirst = (views: View[], names: Set<string> | string): boolean =>
  views.some((v) => (typeof names === 'string' ? first(v.rel) === names : names.has(first(v.rel))));
/** Is a path (from the repo root, and from the app folder when that is elsewhere) inside `node_modules` or a build tool's output folder? */
export function inBuildOutput(inRepo: string, inApp: string | null): boolean {
  return inRepo.split('/').includes('node_modules') || [inRepo, inApp].some((p) => p !== null && OUTPUT_DIRS.has(first(p)));
}
/** Does one of the listed plan paths (a file, or a folder and everything in it) cover this path? */
const covered = (views: View[], entries: readonly string[]): boolean =>
  entries.some((entry) => views.some((v) => {
    const listedAs = rel(v.base, resolve(v.base, entry));
    return listedAs !== null && listedAs !== '' && (v.rel === listedAs || v.rel.startsWith(`${listedAs}/`));
  }));
const insideDir = (dir: string, p: string): boolean => dir !== '' && rel(resolveReal(dir, '.'), p) !== null;
/** `CLAUDE.md`, `AGENTS.md` and `AGENTS.project.md` at the top of the repo: the instructions the AI works under. */
const INSTRUCTIONS = /^(?:claude|agents(?:\.project)?)\.md$/i;

const git = (root: string, args: string[]) =>
  spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
const prefixes = new Map<string, string | null>();
const ignoreAnswers = new Map<string, boolean>();

/** Where `root` sits inside its git repo, as `sub/` ('' when it is the top), or null if git cannot say. */
function repoPrefix(root: string): string | null {
  if (!prefixes.has(root)) {
    const run = git(root, ['rev-parse', '--show-prefix']);
    prefixes.set(root, run.status === 0 ? run.stdout.trim().replace(/\\/g, '/') : null);
  }
  return prefixes.get(root) ?? null;
}

/**
 * Does a `.gitignore` inside `root` ignore this path? Asked of git once per path and kept for the
 * rest of the run. Ignore rules from git's private exclude file, the user's global ignore file, or a
 * `.gitignore` above `root` (when the project is a folder inside a bigger repo) do not count,
 * because the AI can edit those without the project noticing. A folder that is not a git repo, or
 * any git failure, counts as "not ignored", which keeps the path guarded.
 */
function gitIgnores(root: string, relPath: string): boolean {
  const key = `${root}\n${relPath}`;
  const known = ignoreAnswers.get(key);
  if (known !== undefined) return known;
  const run = git(root, ['check-ignore', '-v', '--', relPath]);
  // `source:line:pattern<TAB>path`, with the source relative to the top of the git repo. Exit 1 is
  // "not ignored"; 128 is "not a repo" or another git failure.
  const match = run.status === 0 ? /^((?:[a-z]:)?[^:]*):\d+:(.*)\t/i.exec(run.stdout) : null;
  const source = match?.[1].replace(/\\/g, '/') ?? '';
  let ignored = match !== null && !isAbsolute(source) && basename(source) === '.gitignore' && !match[2].startsWith('!');
  if (ignored) {
    const prefix = repoPrefix(root);
    ignored = prefix !== null && source.toLowerCase().startsWith(prefix.toLowerCase());
  }
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
  const root = resolveReal(ctx.root, '.');
  const p = resolveReal(root, absPath);
  if (insideDir(ctx.dataDir, p)) return 'data-dir';
  if (insideDir(ctx.pluginRoot, p)) return 'plugin';
  if (isUserClaudeConfig(p)) return 'user-claude-config';
  const inRepo = rel(root, p);
  if (inRepo === null) return 'outside';

  const appDir = resolveReal(root, ctx.appRoot || '.');
  const inApp = rel(appDir, p);
  const views: View[] = [{ base: root, rel: inRepo }];
  if (inApp !== null && appDir !== root) views.push({ base: appDir, rel: inApp });
  const plan = ctx.plan;

  if (first(inRepo) === '.seam') return 'seam-records';
  if (hasFirst(views, '.claude') || views.some((v) => INSTRUCTIONS.test(v.rel))) return 'claude-config';
  if (first(inRepo) === 'plan') return 'plan';
  if (plan?.legacyRoot != null) {
    const old = resolveReal(root, plan.legacyRoot);
    // The new app may live inside the old tree (old app at the repo root, new one in seam-app/).
    const appInsideOld = appDir !== old && rel(old, appDir) !== null;
    if (rel(old, p) !== null && !(appInsideOld && inApp !== null)) return 'legacy';
  }
  // Every protected place comes before "ignored", so a node_modules folder inside tests/ or contracts/
  // cannot turn them into something the guard lets through.
  if (hasFirst(views, TEST_DIRS)) return 'tests';
  if (hasFirst(views, 'contracts')) return 'contracts';
  if (hasFirst(views, 'fixtures') || views.some((v) => /^probes\/fixtures(?:\/|$)/.test(v.rel))) return 'fixtures';
  if (covered(views, plan?.generated ?? [])) return 'generated';
  // `.git/` holds git's own settings, hooks and exclude list: all of them can change what counts as code.
  if (CONFIG_NAME.test(basename(inRepo)) || hasFirst(views, '.git') || covered(views, plan?.config ?? [])) return 'config-file';
  if (inBuildOutput(inRepo, inApp) || gitIgnores(root, inRepo)) return 'ignored';
  return isCodeFile(inApp ?? inRepo) ? 'app-code' : 'other-in-repo';
}
