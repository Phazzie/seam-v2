// `seam init`: start a seam project in this folder. It makes `.seam/` (the state, in phase setup with no blocks; the
// data folder written down in env.json, since the commands cannot see CLAUDE_PLUGIN_DATA), lists the project in the
// data folder (so deleting `.seam/` cannot switch the guard off), takes the first snapshot of the protected files, and
// logs it. The project is listed only once its state exists: a listed folder with no state is "missing", and blocks every call.
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, win32 } from 'node:path';
import { loadPlan } from '../formats/plan.ts';
import type { SeamState } from '../formats/state.ts';
import { buildCtx } from '../guard/context.ts';
import { snapshotProtected } from '../guard/tamper.ts';
import { atomicWrite } from '../lib/atomic.ts';
import { logLine } from '../lib/log.ts';
import { registerProject } from '../lib/paths.ts';
import { isListed } from '../lib/registry.ts';
import { withEffectiveRoots } from '../lib/roots.ts';
import { readState, writeState } from '../lib/store.ts';
import { ENV_PATH, findRoot, readEnvFile } from './home.ts';
import { lostStateRefusal } from './initsigns.ts';
import { desktopFolder, installShortcut } from './shortcut.ts';
import { findLink } from './shortcutlink.ts';
import { scriptPathFor, shortcutNameFor } from './shortcutnames.ts';
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
  /** Where the desktop shortcut is (a test hands in a folder); null for the real desktop. Only a setup being made whole again looks at it. */
  desktopDir?: string | null;
  platform?: NodeJS.Platform;
}

const isFolder = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
};

/**
 * Is the setup of this project (which has its state) not whole? Judged by what is left of it (R83), not by the data folder being there: a
 * hook's refusal writes the state's copy into the data folder, which makes a lost folder again, empty. So: no `.seam/env.json`, or a data
 * folder that is gone, or the project not in the project list kept there, or (where the project has a desktop shortcut) no launcher for it.
 */
function setupIncomplete(root: string, o: InitOptions): boolean {
  const env = readEnvFile(root);
  if (env === null || !existsSync(env.dataDir) || !isListed(root, env.dataDir)) return true;
  const desktop = desktopFolder(o.desktopDir ?? null, o.platform);
  return desktop !== null && findLink(root, desktop) !== null && !existsSync(scriptPathFor(env.dataDir, root));
}

/**
 * After a lost data folder the desktop shortcut's target, this project's seam-approve-<rootKey>.cmd, is lost with it, and the window cannot open.
 * If this project's shortcut ("Seam Approve - <folder name>", or the old single-name one if it is this project's, R81) is on the desktop, write the
 * script again and point the shortcut at it (the data folder may be elsewhere now); the owner is told so. If it is not, the owner is told to
 * run seam install-shortcut first. Never fails the setup: what went wrong is said instead.
 */
function shortcutNote(root: string, o: InitOptions): string {
  const record = 'to take a fresh record of the protected files if the guard says its record is missing';
  const install = `First run seam install-shortcut (from Claude Code) to put the "${shortcutNameFor(root)}" shortcut on the desktop; then open the window and choose "Accept my own edits" ${record}.`;
  try {
    const desktop = desktopFolder(o.desktopDir ?? null, o.platform);
    if (desktop === null || findLink(root, desktop) === null) return install;
    const made = installShortcut({ root, dataDir: o.dataDir, pluginRoot: o.pluginRoot, desktopDir: o.desktopDir ?? null, platform: o.platform });
    return `The "${win32.basename(made.link, '.lnk')}" shortcut on your desktop works again: open it, and choose "Accept my own edits" ${record}.`;
  } catch (err) {
    return `${install} (The desktop shortcut could not be checked: ${(err as Error).message})`;
  }
}

/**
 * Make an incomplete setup whole again (R77): write env.json, make sure the data folder is there and the project is listed in it, and put
 * the state's copy where the guard looks for it. The guard's record of the protected files lives in the data folder; if that was lost,
 * the owner's "accept my own edits" in the Seam Approve window takes a fresh one, so nothing the AI can run does.
 */
function completeSetup(root: string, o: InitOptions): string {
  const env: SeamEnv = { ...readEnvFile(root), dataDir: o.dataDir };
  mkdirSync(o.dataDir, { recursive: true });
  atomicWrite(join(root, ENV_PATH), `${JSON.stringify(env, null, 2)}\n`);
  registerProject(root, o.dataDir);
  writeState(root, o.dataDir, readState(root));
  logLine(root, 'Seam project setup completed again', o.now);
  return `This project's setup was incomplete and is whole again (its records folder is ${o.dataDir}). ${shortcutNote(root, o)}`;
}

/** Start the project. Returns what to tell the owner. Throws, in plain words, if it should not be started here. */
export function initProject(o: InitOptions): string {
  const root = realpathSync.native(o.cwd);
  const existing = findRoot(root, ['.seam/state.json']);
  if (existing !== null && existing !== root) throw new Error(`${root} is already inside the seam project at ${existing}, so a new one is not started here.`);
  if (existing !== null) {
    if (setupIncomplete(root, o)) return completeSetup(root, o);
    throw new Error(`${root} is a seam project already.`);
  }
  // No state.json is not the same as new (R82): if anything else of the project is left, starting it again would wipe what the guard saved.
  const lost = lostStateRefusal(root, o.dataDir);
  if (lost !== null) throw new Error(lost);
  for (const [flag, folder] of [['--app-root', o.appRoot], ['--legacy', o.legacy]] as const) {
    if (folder !== undefined && !isFolder(resolve(root, folder))) throw new Error(`${flag} ${folder}: there is no such folder in ${root}.`);
  }
  const env: SeamEnv = { dataDir: o.dataDir, ...(o.appRoot === undefined ? {} : { appRoot: o.appRoot }), ...(o.legacy === undefined ? {} : { legacyRoot: o.legacy }) };
  // A plan that is here already must name the same folders (R81): if it does not, the guard would refuse every call, so nothing is written.
  const plan = loadPlan(root);
  if (plan !== null) withEffectiveRoots(plan, env);
  const state: SeamState = { version: 1, phase: 'setup', turn: { agentId: null, file: null, startedAt: null }, strikes: {}, parked: [], done: [], approvals: [], blocks: 0, halted: null };
  mkdirSync(join(root, '.seam'), { recursive: true });
  atomicWrite(join(root, ENV_PATH), `${JSON.stringify(env, null, 2)}\n`);
  writeState(root, o.dataDir, state);
  registerProject(root, o.dataDir);
  const now = o.now ?? new Date();
  // The context the next hook will build, plan and all, so the first snapshot holds what that hook expects to find (R82): a file only plan.config protects, say.
  snapshotProtected(buildCtx(root, o.dataDir, o.pluginRoot, now));
  const notes = [o.appRoot === undefined ? '' : `app folder ${o.appRoot}`, o.legacy === undefined ? '' : `old app ${o.legacy}`].filter((note) => note !== '');
  logLine(root, `Seam project started${notes.length === 0 ? '' : ` (${notes.join(', ')})`}`, now);
  return `Seam project started in ${root}. Next: seam install-shortcut puts a "${shortcutNameFor(root)}" shortcut on your desktop, for approving the big steps.`;
}
