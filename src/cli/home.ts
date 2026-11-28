// Where a `seam` command is run: which project, where its data folder is, where the plugin is. The CLI is not a hook,
// so it does not get CLAUDE_PLUGIN_DATA; `seam init` writes the data folder into `.seam/env.json` and every later
// command reads it from there (SEAM_DATA_DIR beats it, for a test).
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ENV_PATH, loadEnv } from '../formats/env.ts';
import type { SeamEnv } from '../formats/env.ts';
import { buildCtx } from '../guard/context.ts';
import type { Ctx } from '../types.ts';
import type { CliEnv } from '../config/cli.ts';

export { ENV_PATH };
export type { SeamEnv };

/** A folder, a data folder and a plugin folder: what every command needs, whether or not the project's records can be read. */
export interface Where { root: string; dataDir: string; pluginRoot: string }

const STATE = join('.seam', 'state.json');

/** The nearest folder at or above `from` that holds `.seam/state.json` (or `.seam/env.json`, which survives a deleted state), or null. */
export function findRoot(from: string, markers: readonly string[] = [STATE, ENV_PATH]): string | null {
  for (let dir = realpathSync.native(from); ; dir = dirname(dir)) {
    if (markers.some((marker) => existsSync(join(dir, marker)))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/** What `.seam/env.json` says, or null if it is not there. */
export const readEnvFile = (root: string): SeamEnv | null => loadEnv(root);

/** The project cannot be found, or its setup is incomplete: not a damaged record (which `seam repair` can put back), so the window says to run seam init again, not to repair. */
export class SetupError extends Error {}

/** Which project the command is run in, and where everything else is. Throws a SetupError, in plain words, if it is not in a seam project or its setup is incomplete. */
export function whereAmI(cwd: string, env: CliEnv, pluginRoot: string): Where {
  const root = findRoot(cwd);
  if (root === null) throw new SetupError(`${cwd} is not a seam project (there is no .seam folder here or above it). Run seam init to start one.`);
  const dataDir = env.dataDir ?? readEnvFile(root)?.dataDir;
  if (dataDir === undefined) throw new SetupError("This project's setup is incomplete; run seam init again from Claude Code.");
  if (!existsSync(dataDir)) throw new SetupError(`The folder that holds this project's guard records (${dataDir}) no longer exists, so seam cannot find them. Run seam init again from Claude Code to set it up afresh.`);
  return { root, dataDir, pluginRoot };
}

/** The data folder `seam init` writes down: the one it was told, or the one Claude Code gave it. */
export function dataDirForInit(env: CliEnv): string {
  const dir = env.dataDir ?? env.pluginData;
  if (dir === null) throw new Error("seam doesn't know where the plugin keeps its data. Start it from Claude Code, or set SEAM_DATA_DIR to the plugin's data folder (Claude Code keeps it under .claude/plugins/data/), and run seam init again.");
  return dir;
}

/** The context the guard modules take, read from what the project holds on disk. Throws if the state, plan or lock cannot be read. */
export const loadCtx = (where: Where, now: Date = new Date()): Ctx => buildCtx(where.root, where.dataDir, where.pluginRoot, now);
