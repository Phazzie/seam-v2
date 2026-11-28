// The "Seam Approve" desktop shortcut. `seam install-shortcut` writes `seam-approve.cmd` into the data folder (it goes to
// the project and runs `seam approve`) and makes a shortcut to it on the desktop. `seam approve` then accepts only a
// window that was opened from that file: somewhere up its chain of parent processes there is a cmd.exe whose command line
// names the installed seam-approve.cmd (what Windows runs for a shortcut to it). That stops the realistic case, the AI
// starting a window by itself with node, npx or Start-Process; it is a check against a helpful AI, not against an attacker.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { atomicWrite } from '../lib/atomic.ts';

export const SCRIPT_NAME = 'seam-approve.cmd';
export const SHORTCUT_NAME = 'Seam Approve';
/** How far up the chain of parent processes to look: a window is a cmd.exe a step or two above the node that runs approve. */
const CHAIN_DEPTH = 8;
const POWERSHELL_LIMIT_MS = 30_000;

export interface ProcessRow { name: string; commandLine: string }

/** Run a PowerShell script (passed encoded, so no quoting can change it) and give its output. Throws, in plain words, if it fails. */
function powershell(script: string, what: string): string {
  const encoded = Buffer.from(`[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${script}`, 'utf16le').toString('base64');
  const done = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    encoding: 'utf8', windowsHide: true, timeout: POWERSHELL_LIMIT_MS,
  });
  if (done.error !== undefined) throw new Error(`Could not ${what}: PowerShell did not run (${done.error.message}).`);
  if (done.status !== 0) throw new Error(`Could not ${what}: ${done.stderr.trim() || `PowerShell stopped with ${String(done.status)}`}`);
  return done.stdout;
}

/** The text of a PowerShell single-quoted string. */
const quoted = (text: string): string => `'${text.replace(/'/g, "''")}'`;

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

/** What seam-approve.cmd holds: go to the project, run the approval, and wait so the owner can read the answer. */
export function approveScript(root: string, pluginRoot: string): string {
  if (/["\r\n\0]/.test(root)) throw new Error(`The folder ${JSON.stringify(root)} can't be used in the shortcut's script (a quote or a line break in its name).`);
  const folder = root.replace(/%/g, '%%'); // cmd reads %name% as a variable
  return ['@echo off', `cd /d "${folder}"`, `node "${win32.join(pluginRoot, 'dist', 'seam.mjs')}" approve`, 'pause', ''].join('\r\n');
}

export interface ShortcutOptions {
  root: string;
  dataDir: string;
  pluginRoot: string;
  /** Where the shortcut goes: the desktop folder, or null for the real desktop (a test hands in a folder of its own). */
  desktopDir: string | null;
  platform?: NodeJS.Platform;
}

/** Write seam-approve.cmd and make the shortcut to it. Returns where both are. Throws, in plain words, if it cannot. */
export function installShortcut(o: ShortcutOptions): { script: string; link: string } {
  if ((o.platform ?? process.platform) !== 'win32') throw new Error('The Seam Approve shortcut is only made on Windows.');
  const script = join(o.dataDir, SCRIPT_NAME);
  mkdirSync(o.dataDir, { recursive: true });
  atomicWrite(script, approveScript(o.root, o.pluginRoot));
  const desktop = o.desktopDir === null ? "[Environment]::GetFolderPath('Desktop')" : quoted(o.desktopDir);
  const made = powershell([
    "$ErrorActionPreference = 'Stop'",
    `$link = Join-Path (${desktop}) ${quoted(`${SHORTCUT_NAME}.lnk`)}`,
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($link)',
    `$s.TargetPath = ${quoted(script)}`,
    `$s.WorkingDirectory = ${quoted(o.root)}`,
    `$s.Description = ${quoted('Approve the next big step of a Seam project')}`,
    '$s.Save()',
    'Write-Output $link',
  ].join('; '), 'make the Seam Approve shortcut').trim();
  if (made === '' || !existsSync(made)) throw new Error('Could not make the Seam Approve shortcut: Windows did not create it.');
  return { script, link: made };
}
