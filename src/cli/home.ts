// Where a `seam` command is run: which project, where its data folder is, where the plugin is. The CLI is not a hook,
// so it does not get CLAUDE_PLUGIN_DATA; `seam init` writes the data folder into `.seam/env.json` and every later
// command reads it from there (SEAM_DATA_DIR beats it, for a test).
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { loadJson } from '../formats/read.ts';
import { buildCtx } from '../guard/context.ts';
import type { Ctx } from '../types.ts';
import type { CliEnv } from '../config/cli.ts';

export const ENV_PATH = '.seam/env.json';
const EnvSchema = z.strictObject({ dataDir: z.string().min(1), appRoot: z.string().optional(), legacyRoot: z.string().optional() });
export type SeamEnv = z.infer<typeof EnvSchema>;

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
export const readEnvFile = (root: string): SeamEnv | null => loadJson(EnvSchema, root, ENV_PATH);

/** Which project the command is run in, and where everything else is. Throws, in plain words, if it is not in a seam project. */
export function whereAmI(cwd: string, env: CliEnv, pluginRoot: string): Where {
  const root = findRoot(cwd);
  if (root === null) throw new Error(`${cwd} is not a seam project (there is no .seam folder here or above it). Run seam init to start one.`);
  const dataDir = env.dataDir ?? readEnvFile(root)?.dataDir;
  if (dataDir === undefined) throw new Error(`${join(root, ENV_PATH)} is missing, so seam does not know where its data folder is. Set SEAM_DATA_DIR to it.`);
  return { root, dataDir, pluginRoot };
}

/** The data folder `seam init` writes down: the one it was told, or the one Claude Code gave it. */
export function dataDirForInit(env: CliEnv): string {
  const dir = env.dataDir ?? env.pluginData;
  if (dir === null) throw new Error("seam doesn't know where the plugin's data folder is. Set SEAM_DATA_DIR to it (Claude Code keeps it under .claude/plugins/data/) and run seam init again.");
  return dir;
}

/** The context the guard modules take, read from what the project holds on disk. Throws if the state, plan or lock cannot be read. */
export const loadCtx = (where: Where, now: Date = new Date()): Ctx => buildCtx(where.root, where.dataDir, where.pluginRoot, now);
