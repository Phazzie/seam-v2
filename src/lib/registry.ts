// Which folder is a seam project. A project is a folder with `.seam/state.json`. Every project is
// also written into a list kept outside the repo (`<data folder>/projects.json`), so that deleting
// `.seam/` cannot switch the guard off: a listed folder whose records are gone is "missing".
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { STATE_PATH } from '../formats/state.ts';
import { loadJson } from '../formats/read.ts';
import { resolveReal } from './realpath.ts';

export const REGISTRY_FILE = 'projects.json';
const RegistrySchema = z.strictObject({ projects: z.array(z.string()) });

export type ProjectLookup = { kind: 'none' } | { kind: 'seam'; root: string } | { kind: 'missing'; root: string };

/** The listed project roots, as resolveReal spells them. An absent list is an empty one. */
function listed(dataDir: string): string[] {
  const saved = loadJson(RegistrySchema, dataDir, REGISTRY_FILE);
  return (saved?.projects ?? []).map((root) => resolveReal(root, root));
}

/**
 * Walk up from `cwd`. The nearest folder that holds `.seam/state.json` is the project (`seam`);
 * a listed folder met first whose records are gone is `missing`; otherwise `none`, and the guard
 * stays out of the way. Throws if the project list exists but cannot be read (the guard then
 * refuses rather than guess).
 */
export function findProject(cwd: string, dataDir: string): ProjectLookup {
  let dir = resolveReal(cwd, '.');
  const known = new Set(listed(dataDir));
  for (;;) {
    if (existsSync(join(dir, STATE_PATH))) return { kind: 'seam', root: dir };
    if (known.has(dir)) return { kind: 'missing', root: dir };
    const parent = dirname(dir);
    if (parent === dir) return { kind: 'none' };
    dir = parent;
  }
}

/** Add a project to the list (once). The file is replaced whole, so a reader never sees half of it. */
export function registerProject(root: string, dataDir: string): void {
  const entry = resolveReal(root, root);
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
