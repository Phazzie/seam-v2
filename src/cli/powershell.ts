// Running a PowerShell script from the shortcut code: the desktop folder, the parent chain of a window, and the shortcut files all
// need Windows' own COM objects and process list, which only PowerShell reaches from here.
import { spawnSync } from 'node:child_process';

const POWERSHELL_LIMIT_MS = 30_000;

/** Run a PowerShell script (passed encoded, so no quoting can change it) and give its output. Throws, in plain words, if it fails. */
export function powershell(script: string, what: string): string {
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
export const quoted = (text: string): string => `'${text.replace(/'/g, "''")}'`;
