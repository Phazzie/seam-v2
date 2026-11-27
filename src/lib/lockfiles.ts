// Which files the lock covers whole (everything that is not a planned code file), and where a path
// from the plan really is on disk. Plan paths may be relative to the repo or to the app folder.
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Plan } from '../formats/plan.ts';
import { PLAN_PATH } from '../formats/plan.ts';

export interface Located { abs: string; key: string }

/** Folders that only a tool writes into; they are not part of what was frozen. */
const SKIPPED = new Set(['node_modules', '.git']);
/** The protected folders whose files are all locked, as the path classifier knows them. */
const FROZEN_DIRS = ['contracts', 'tests', 'test', 'fixtures', 'probes/fixtures'];
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

/** Is this a file the parser can read (so a builder can fill it in), rather than data? */
export const isScriptPath = (path: string): boolean => SCRIPT.test(path);

/** The lock's name for a file: its path from the repo root, with forward slashes. */
function keyOf(root: string, abs: string): string {
  const key = relative(root, abs).replace(/\\/g, '/');
  if (key === '' || key === '..' || key.startsWith('../') || isAbsolute(key)) throw new Error(`${abs} isn't inside the project folder, so it can't be locked.`);
  return key;
}

/** Find a path from the plan on disk: under the app folder first, then under the repo root. Null if it isn't there. */
export function locate(root: string, appRoot: string, path: string): Located | null {
  for (const base of [resolve(root, appRoot), root]) {
    const abs = resolve(base, path);
    if (existsSync(abs)) return { abs, key: keyOf(root, abs) };
  }
  return null;
}

/** A file, or every file under a folder. Links are taken as files and not followed into, so a loop can't trap the walk. */
function filesUnder(abs: string): string[] {
  if (!existsSync(abs)) return [];
  if (!lstatSync(abs).isDirectory()) return [abs];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => (SKIPPED.has(e.name) ? [] : filesUnder(join(abs, e.name))));
}

/** Everything that is locked whole and not named as a code file: the plan, the frozen folders, the config files. */
export function wholeFiles(root: string, plan: Plan): Located[] {
  const appDir = resolve(root, plan.appRoot);
  const bases = appDir === root ? [root] : [appDir, root];
  const wanted = [
    resolve(root, PLAN_PATH),
    ...bases.flatMap((base) => FROZEN_DIRS.map((dir) => resolve(base, dir))),
    ...plan.config.flatMap((entry) => locate(root, plan.appRoot, entry)?.abs ?? []),
  ];
  return wanted.flatMap(filesUnder).map((abs) => ({ abs, key: keyOf(root, abs) }));
}
