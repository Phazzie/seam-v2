// Test helpers for the `seam` command: a folder that is not a seam project yet (for `seam init`), the owner's
// side of the approval window (a stand-in for the keyboard and the screen), and the hook run against a folder.
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildCtx } from '../../src/guard/context.ts';
import type { OwnerIo } from '../../src/cli/owner.ts';
import type { Ctx, HookInput } from '../../src/types.ts';
import type { App } from './app.ts';
import { FIXTURE, planFile, skeleton } from './code.ts';
import { interpret, runNode } from './run.ts';
import type { HookResult, ProcResult } from './run.ts';
import { put } from './project.ts';
import { scratchDir } from './scratch.ts';

const REPO = resolve(import.meta.dirname, '../..');
const CLI = join(REPO, 'dist/seam.mjs');
const HOOK = join(REPO, 'dist/hook.mjs');

/** The environment a command or a hook gets: nothing of the developer's own SEAM_TEST_ or CLAUDE_ settings, plus what is given. */
export function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(base)) if (/^(SEAM_|CLAUDE_)/i.test(key)) delete base[key];
  return { ...base, ...extra };
}

export interface Folder {
  root: string;
  dataDir: string;
  pluginRoot: string;
  /** Run `node dist/seam.mjs <args>` in the folder, with no keyboard (stdin is a pipe). */
  cli(args: string[], extra?: Record<string, string>): Promise<ProcResult>;
  /** Run the real hook, as Claude Code would, for a call in this folder. */
  hook(input: Partial<HookInput> & { hook_event_name: string }): Promise<HookResult>;
  read(rel: string): string;
  ctx(): Ctx;
}

/** A git folder with the practice plan and a skeleton for every planned code file, and no `.seam/` yet. */
export function plainFolder(): Folder {
  const root = scratchDir('seam-plain-');
  const dataDir = scratchDir('seam-plain-data-');
  const pluginRoot = scratchDir('seam-plain-plugin-');
  cpSync(FIXTURE, root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const path of ['src/pricing/total.ts', 'src/greeting/Greeting.tsx']) {
    const { seam, file } = planFile(path);
    put(root, path, skeleton(seam, file));
  }
  return folderAt(root, dataDir, pluginRoot);
}

/** The commands and the hook, for a seam project at `root` whose data folder is `dataDir`. */
export function folderAt(root: string, dataDir: string, pluginRoot: string): Folder {
  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => cleanEnv({ SEAM_DATA_DIR: dataDir, CLAUDE_PLUGIN_ROOT: pluginRoot, ...extra });
  return {
    root,
    dataDir,
    pluginRoot,
    cli: (args, extra) => runNode(CLI, args, '', root, env(extra)),
    hook: async (input) => {
      const stdin = JSON.stringify({ cwd: root, session_id: 'test-session', ...input });
      return interpret(await runNode(HOOK, [], stdin, root, cleanEnv({ CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_PLUGIN_ROOT: pluginRoot })));
    },
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
    ctx: () => buildCtx(root, dataDir, pluginRoot, new Date()),
  };
}

/** The same two, for an app made by makeApp. */
export const folderOf = (app: App): Folder => folderAt(app.root, app.dataDir, app.pluginRoot);

export interface Window {
  io: OwnerIo;
  /** Everything the window printed. */
  said: string[];
  /** The questions it asked. */
  asked: string[];
}

/**
 * The owner's side: a window with a keyboard and a screen. `typed` are the lines the owner types, one for each question
 * (running out is a test bug). By default the window has been opened from the shortcut; `opts` say otherwise.
 */
export function window(typed: string[], opts: Partial<Pick<OwnerIo, 'stdinTty' | 'stdoutTty' | 'byShortcut'>> = {}): Window {
  const said: string[] = [];
  const asked: string[] = [];
  const lines = [...typed];
  const io: OwnerIo = {
    stdinTty: true,
    stdoutTty: true,
    byShortcut: () => true,
    say: (text) => void said.push(text),
    ask: (question) => {
      asked.push(question);
      const line = lines.shift();
      if (line === undefined) return Promise.reject(new Error(`The test did not type an answer to: ${question}`));
      return Promise.resolve(line);
    },
    ...opts,
  };
  return { io, said, asked };
}
