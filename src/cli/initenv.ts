// The setup file of a project whose setup is being made whole again (R84): where `.seam/env.json` comes from when it has to be written
// anew. The guard's record of the protected files holds a kept copy of it (the folders `seam init --app-root` and `--legacy` were given
// included), so that is taken first; then what is on disk; and the same two flags may give a folder again where nothing else knows it.
// Writing it any other way would drop the folders, and the record would then put the original back and halt the run as tampering.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENV_PATH, parseEnv } from '../formats/env.ts';
import type { SeamEnv } from '../formats/env.ts';
import { blobOf, fold, loadRecord } from '../guard/tamperrecord.ts';
import type { Home } from '../guard/tamperrecord.ts';
import { readEnvFile } from './home.ts';

export interface Folders { dataDir: string; appRoot?: string; legacy?: string }

const isFolder = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
};

/** Each folder named by a flag must be there. Throws, in plain words, if not. */
export function requireFolders(root: string, given: Pick<Folders, 'appRoot' | 'legacy'>): void {
  for (const [flag, folder] of [['--app-root', given.appRoot], ['--legacy', given.legacy]] as const) {
    if (folder !== undefined && !isFolder(resolve(root, folder))) throw new Error(`${flag} ${folder}: there is no such folder in ${root}.`);
  }
}

/** The guard's kept copy of `.seam/env.json`, or null if its record does not hold one (no record, or a file too big to keep). */
export function savedEnv(home: Home): SeamEnv | null {
  const rec = loadRecord(home);
  const key = rec === null ? undefined : Object.keys(rec.files).find((name) => fold(name) === fold(ENV_PATH));
  const kept = rec === null || key === undefined ? null : blobOf(home, rec.files[key].hash);
  return kept === null ? null : parseEnv(JSON.parse(kept.toString('utf8').replace(/^\uFEFF/, '')), "The guard's saved copy of .seam/env.json");
}

/**
 * The env.json to write: the guard's saved copy if it has one, else the one on disk, with the data folder as it is now; a folder given by a
 * flag is added where there was none, and one that disagrees with what is saved is refused rather than changed here.
 */
export function recoveredEnv(root: string, o: Folders): SeamEnv {
  requireFolders(root, o);
  const env: SeamEnv = { ...(savedEnv({ root, dataDir: o.dataDir }) ?? readEnvFile(root)), dataDir: o.dataDir };
  for (const [flag, key, given] of [['--app-root', 'appRoot', o.appRoot], ['--legacy', 'legacyRoot', o.legacy]] as const) {
    const had = env[key];
    if (given === undefined) continue;
    if (had === undefined) env[key] = given;
    else if (resolve(root, had) !== resolve(root, given)) throw new Error(`${flag} ${given}: this project's saved setup says "${had}", so it is not changed here.`);
  }
  return env;
}
