// The "Seam Approve" desktop shortcut. `seam install-shortcut` writes this project's launcher, seam-approve-<rootKey>.cmd, into the data folder
// (it goes to the project and runs `seam window`, the owner's one place, R77) and makes a shortcut to it on the desktop, "Seam Approve - <folder
// name>" (R81: one each per project, so two projects sharing a data folder do not take each other over). `seam window` and `seam approve` then
// accept only a window that was opened from that file: somewhere up its chain of parent processes there is a cmd.exe whose command line
// names the installed launcher (what Windows runs for a shortcut to it). That stops the realistic case, the AI
// starting a window by itself with node, npx or Start-Process; it is a check against a helpful AI, not against an attacker.
import { existsSync, mkdirSync } from 'node:fs';
import { atomicWrite } from '../lib/atomic.ts';
import { approveScript } from './approvescript.ts';
import { powershell, quoted } from './powershell.ts';
import { dropOldScript, makeLink } from './shortcutlink.ts';
import { scriptPathFor } from './shortcutnames.ts';

export { approveScript };

/** How far up the chain of parent processes to look: a window is a cmd.exe a step or two above the node that runs approve. */
const CHAIN_DEPTH = 8;

export interface ProcessRow { name: string; commandLine: string }

/** "name<TAB>command line" rows, one process each, nearest parent first. */
export function parseChain(output: string): ProcessRow[] {
  return output.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => {
    const tab = line.indexOf('\t');
    return tab < 0 ? { name: line.trim(), commandLine: '' } : { name: line.slice(0, tab).trim(), commandLine: line.slice(tab + 1) }; // trim: a byte-order mark may start the first row
  });
}

/** The process `pid` and each parent above it, as Windows reports them (`Get-CimInstance Win32_Process`). */
function windowsChain(pid: number): ProcessRow[] {
  const script = `$p = ${pid}; for ($i = 0; $i -lt ${CHAIN_DEPTH} -and $p; $i++) { $w = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p); if (-not $w) { break }; ($w.Name + [char]9 + $w.CommandLine); $p = $w.ParentProcessId }`;
  return parseChain(powershell(script, 'check how this window was opened'));
}

const spelled = (path: string): string => path.toLowerCase().replace(/\//g, '\\');

/** Is one of these processes a cmd.exe that was run on `script`? Case and slashes do not matter. */
export function shortcutInChain(rows: readonly ProcessRow[], script: string): boolean {
  return rows.some((row) => row.name.toLowerCase() === 'cmd.exe' && spelled(row.commandLine).includes(spelled(script)));
}

/**
 * Was this process started from the Seam Approve shortcut, that is from the installed `script`? Only Windows has such a
 * shortcut, so anywhere else the answer is no. `chain` and `platform` are for a test to hand in.
 */
export function launchedByShortcut(script: string, chain: (pid: number) => ProcessRow[] = windowsChain, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && shortcutInChain(chain(process.ppid), script);
}

/** The folder the desktop shortcut goes in: the one handed in (a test), or the real desktop, which Windows may keep somewhere other than `~/Desktop` (OneDrive). Null where there is no such shortcut (not Windows). */
export function desktopFolder(injected: string | null, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== 'win32') return null;
  return injected ?? powershell("[Environment]::GetFolderPath('Desktop')", 'find the desktop folder').trim();
}

export interface ShortcutOptions {
  root: string;
  dataDir: string;
  pluginRoot: string;
  /** Where the shortcut goes: the desktop folder, or null for the real desktop (a test hands in a folder of its own). */
  desktopDir: string | null;
  platform?: NodeJS.Platform;
}

/**
 * Write this project's launcher and make its shortcut to it. The old single-name launcher and shortcut are replaced if they are this
 * project's, and left alone if they are another's (R81). Returns where the launcher and the shortcut are. Throws, in plain words, if it cannot.
 */
export function installShortcut(o: ShortcutOptions): { script: string; link: string } {
  if ((o.platform ?? process.platform) !== 'win32') throw new Error('The Seam Approve shortcut is only made on Windows.');
  const script = scriptPathFor(o.dataDir, o.root);
  mkdirSync(o.dataDir, { recursive: true });
  atomicWrite(script, approveScript(o.root, o.pluginRoot));
  const desktop = o.desktopDir === null ? "[Environment]::GetFolderPath('Desktop')" : quoted(o.desktopDir);
  const link = makeLink({ root: o.root, script, desktop });
  if (link === '' || !existsSync(link)) throw new Error('Could not make the Seam Approve shortcut: Windows did not create it.');
  dropOldScript(o.dataDir, o.root);
  return { script, link };
}
