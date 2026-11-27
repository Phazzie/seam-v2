// Which folder is a seam project. A project is a folder with `.seam/state.json`. Every project is
// also written into a list kept outside the repo (`<data folder>/projects.json`), so that deleting
// `.seam/` cannot switch the guard off: a listed folder whose records are gone is "missing".
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { loadJson } from '../formats/read.ts';
import { STATE_PATH } from '../formats/state.ts';
import { resolveReal } from './realpath.ts';

export const REGISTRY_FILE = 'projects.json';
export const WARNINGS_FILE = 'registry-warnings.log';
const RegistrySchema = z.strictObject({ projects: z.array(z.string()) });

export type ProjectLookup = { kind: 'none' } | { kind: 'seam'; root: string } | { kind: 'missing'; root: string };

/** The listed project roots, as resolveReal spells them. An absent list is an empty one. Throws if it cannot be read. */
function listed(dataDir: string): string[] {
  const saved = loadJson(RegistrySchema, dataDir, REGISTRY_FILE);
  return (saved?.projects ?? []).map((root) => resolveReal(root, '.'));
}

/**
 * Say, in the data folder, that the project list could not be used. The guard carries on as if the
 * folder were not a seam project (a broken list must not break unrelated repos), so this line is how
 * the owner finds out. If even the line cannot be written, it goes to stderr instead.
 */
function warn(dataDir: string, cwd: string, err: unknown): void {
  const line = `${new Date().toISOString()} ${REGISTRY_FILE} could not be used, so ${cwd} was treated as not a seam project: ${(err as Error).message}\n`;
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(join(dataDir, WARNINGS_FILE), line);
  } catch (writeErr) {
    process.stderr.write(`seam: ${line}seam: and ${WARNINGS_FILE} could not be written: ${(writeErr as Error).message}\n`);
  }
}

/**
 * Walk up from `cwd`. The nearest folder that holds `.seam/state.json` is the project (`seam`).
 * Only if there is none is the project list read: a listed folder on the way up means its records
 * are gone (`missing`); otherwise `none`, and the guard stays out of the way. A list that cannot be
 * read (bad JSON, an entry that cannot be resolved) counts as `none` and is noted in
 * `<data folder>/registry-warnings.log`.
 */
export function findProject(cwd: string, dataDir: string): ProjectLookup {
  const start = resolveReal(cwd, '.');
  const folders = [start];
  for (let up = dirname(start); up !== folders.at(-1); up = dirname(up)) folders.push(up);
  const found = folders.find((dir) => existsSync(join(dir, STATE_PATH)));
  if (found !== undefined) return { kind: 'seam', root: found };
  let known: Set<string>;
  try {
    known = new Set(listed(dataDir));
  } catch (err) {
    warn(dataDir, start, err);
    return { kind: 'none' };
  }
  const gone = folders.find((dir) => known.has(dir));
  return gone === undefined ? { kind: 'none' } : { kind: 'missing', root: gone };
}

/**
 * Add a project to the list (once). The file is replaced whole, so a reader never sees half of it.
 * Throws if the list exists but cannot be read, rather than writing over it.
 */
export function registerProject(root: string, dataDir: string): void {
  const entry = resolveReal(root, '.');
  const projects = listed(dataDir);
  if (projects.includes(entry)) return;
  const file = join(dataDir, REGISTRY_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temp, `${JSON.stringify({ projects: [...projects, entry] }, null, 2)}\n`);
  try {
    renameSync(temp, file);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}
