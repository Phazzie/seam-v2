// The "Seam Approve" desktop shortcut. `seam install-shortcut` writes `seam-approve.cmd` into the data folder (it goes to
// the project and runs `seam window`, the owner's one place, R77) and makes a shortcut to it on the desktop. `seam window` and
// `seam approve` then accept only a window that was opened from that file: somewhere up its chain of parent processes there is a cmd.exe whose command line
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
  // No profile, text output, no progress bar, UTF-8 out so a non-ASCII path survives, and a failure caught and written as one plain line:
  // with -EncodedCommand and a redirected stderr, PowerShell would otherwise write its error as CLIXML (a page of XML).
  const body = `try { ${script} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  const encoded = Buffer.from(`$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${body}`, 'utf16le').toString('base64');
  const done = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
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

/** A path as it goes inside quotes in a .cmd file: a quote or a line break cannot, and cmd reads `%name%` as a variable, so `%` is doubled. */
function forCmd(path: string): string {
  if (/["\r\n\0]/.test(path)) throw new Error(`The folder ${JSON.stringify(path)} can't be used in the shortcut's script (a quote or a line break in its name).`);
  return path.replace(/%/g, '%%');
}

/**
 * What seam-approve.cmd holds: switch the console to UTF-8 (the file is UTF-8, and cmd reads it in the console's code page, so a
 * path with an accent would break), go to the project, run the window, and wait so the owner can read the answer.
 */
export function approveScript(root: string, pluginRoot: string): string {
  const seam = win32.join(pluginRoot, 'dist', 'seam.mjs');
  return ['@echo off', 'chcp 65001 >nul', `cd /d "${forCmd(root)}"`, `node "${forCmd(seam)}" window`, 'pause', ''].join('\r\n');
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
