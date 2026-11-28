// `seam init`: start a seam project in this folder. It makes `.seam/` (the state, in phase setup with no blocks; the
// data folder written down in env.json, since the commands cannot see CLAUDE_PLUGIN_DATA), lists the project in the
// data folder (so deleting `.seam/` cannot switch the guard off), takes the first snapshot of the protected files, and
// logs it. The project is listed only once its state exists: a listed folder with no state is "missing", and blocks every call.
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SeamState } from '../formats/state.ts';
import { snapshotProtected } from '../guard/tamper.ts';
import { atomicWrite } from '../lib/atomic.ts';
import { logLine } from '../lib/log.ts';
import { registerProject } from '../lib/paths.ts';
import { writeState } from '../lib/store.ts';
import type { Ctx } from '../types.ts';
import { ENV_PATH, findRoot } from './home.ts';
import type { SeamEnv } from './home.ts';

export interface InitOptions {
  cwd: string;
  dataDir: string;
  pluginRoot: string;
  /** `--app-root`: where the new app will live, if it is not the repo root. */
  appRoot?: string;
  /** `--legacy`: the old app, which will be protected and rebuilt beside. */
  legacy?: string;
  now?: Date;
}

const isFolder = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
};

/** Start the project. Returns what to tell the owner. Throws, in plain words, if it should not be started here. */
export function initProject(o: InitOptions): string {
  const root = realpathSync.native(o.cwd);
  const existing = findRoot(root, ['.seam/state.json']);
  if (existing !== null) throw new Error(existing === root ? `${root} is a seam project already.` : `${root} is already inside the seam project at ${existing}, so a new one is not started here.`);
  for (const [flag, folder] of [['--app-root', o.appRoot], ['--legacy', o.legacy]] as const) {
    if (folder !== undefined && !isFolder(resolve(root, folder))) throw new Error(`${flag} ${folder}: there is no such folder in ${root}.`);
  }
  const env: SeamEnv = { dataDir: o.dataDir, ...(o.appRoot === undefined ? {} : { appRoot: o.appRoot }), ...(o.legacy === undefined ? {} : { legacyRoot: o.legacy }) };
  const state: SeamState = { version: 1, phase: 'setup', turn: { agentId: null, file: null, startedAt: null }, strikes: {}, parked: [], done: [], approvals: [], blocks: 0, halted: null };
  mkdirSync(join(root, '.seam'), { recursive: true });
  atomicWrite(join(root, ENV_PATH), `${JSON.stringify(env, null, 2)}\n`);
  writeState(root, o.dataDir, state);
  registerProject(root, o.dataDir);
  const now = o.now ?? new Date();
  const ctx: Ctx = { root, appRoot: resolve(root, o.appRoot ?? '.'), dataDir: o.dataDir, pluginRoot: o.pluginRoot, state, plan: null, lock: null, now };
  snapshotProtected(ctx);
  const notes = [o.appRoot === undefined ? '' : `app folder ${o.appRoot}`, o.legacy === undefined ? '' : `old app ${o.legacy}`].filter((note) => note !== '');
  logLine(root, `Seam project started${notes.length === 0 ? '' : ` (${notes.join(', ')})`}`, now);
  return `Seam project started in ${root}. Next: seam install-shortcut puts "Seam Approve" on your desktop, for approving the big steps.`;
}
