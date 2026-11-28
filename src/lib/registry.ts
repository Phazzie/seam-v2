// Which folder is a seam project. A project is a folder with `.seam/state.json`. Every project is
// also written into a list kept outside the repo (`<data folder>/projects.json`), so that deleting
// `.seam/` cannot switch the guard off: a listed folder whose records are gone is "missing".
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { loadJson } from '../formats/read.ts';
import { STATE_PATH } from '../formats/state.ts';
import { atomicWrite } from './atomic.ts';
import { withLockFile } from './lock.ts';
import { staysOnNetwork } from './pathcheck.ts';
import { resolveReal } from './realpath.ts';

export const REGISTRY_FILE = 'projects.json';
export const WARNINGS_FILE = 'registry-warnings.log';
/** The lock file in the data folder that serializes updates of the list. */
export const REGISTRY_LOCK = 'projects.lock';
const RegistrySchema = z.strictObject({ projects: z.array(z.string()) });

export type ProjectLookup = { kind: 'none' } | { kind: 'seam'; root: string } | { kind: 'missing'; root: string };

/** The listed project roots as written. An absent list is an empty one. Throws if it cannot be read. */
function written(dataDir: string): string[] {
  return loadJson(RegistrySchema, dataDir, REGISTRY_FILE)?.projects ?? [];
}

/**
 * A listed root as resolveReal spells it, or null for one that is still a network path once its Windows
 * spellings are made ordinary: it is not resolved (that would ask its host, and a stale entry for a host that
 * does not answer would cost every call the whole time limit). The admin-share alias of a local drive is a
 * local folder and is resolved like any other (R46).
 */
const spelled = (root: string): string | null => (staysOnNetwork(root) ? null : resolveReal(root, '.'));

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
  // The list is never read from a data folder on the network (that would ask its host): not knowing is a doubt.
  if (staysOnNetwork(dataDir)) {
    throw new Error(`the plugin data folder ${dataDir} is on the network, so the project list was not read`);
  }
  let known: Set<string>;
  try {
    // A network entry can only match a path that is itself on the network, which is a doubt already (R44), so it is left out.
    known = new Set(written(dataDir).map(spelled).filter((root): root is string => root !== null));
  } catch (err) {
    warn(dataDir, start, err);
    return { kind: 'none' };
  }
  const gone = folders.find((dir) => known.has(dir));
  return gone === undefined ? { kind: 'none' } : { kind: 'missing', root: gone };
}

/** Is this folder in the project list? Throws, in plain words, if the list exists but cannot be read. */
export function isListed(root: string, dataDir: string): boolean {
  const entry = resolveReal(root, '.');
  return written(dataDir).some((listed) => (spelled(listed) ?? listed) === entry);
}

/**
 * Add a project to the list (once). The file is replaced whole (atomicWrite, which also waits out a Windows
 * reader that has it open for a moment), so a reader never sees half of it and the write never fails on one. The
 * read, the check and the replace happen inside one lock in the data folder (`projects.lock`), so two
 * processes registering different projects at once both end up listed instead of one overwriting the other.
 * Throws if the list exists but cannot be read, rather than writing over it.
 */
export function registerProject(root: string, dataDir: string): void {
  const entry = resolveReal(root, '.');
  const file = join(dataDir, REGISTRY_FILE);
  mkdirSync(dirname(file), { recursive: true });
  withLockFile(join(dataDir, REGISTRY_LOCK), () => {
    const projects = written(dataDir).map((listed) => spelled(listed) ?? listed); // a network entry stays as written
    if (projects.includes(entry)) return;
    atomicWrite(file, `${JSON.stringify({ projects: [...projects, entry] }, null, 2)}\n`);
  });
}
