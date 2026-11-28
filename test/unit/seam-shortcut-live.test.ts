// seam-approve.cmd and the shortcut, run for real on Windows (R77): a path with an accent works (the file is UTF-8, and cmd reads
// it in the console's code page unless the script switches the console first), the script runs the real `seam window`, and a
// PowerShell failure reads as a plain message, not as CLIXML. Nothing touches the owner's real desktop.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { approveScript, installShortcut } from '../../src/cli/shortcut.ts';
import { makeApp } from '../helpers/app.ts';
import { put, tempDir } from '../helpers/project.ts';

const REPO = resolve(import.meta.dirname, '../..');
const WINDOWS = process.platform === 'win32';

/** Run a .cmd file as the shortcut does (cmd /c), with a key press waiting for its `pause`. */
function runCmd(script: string): string {
  const done = spawnSync('cmd.exe', ['/c', script], { input: '\r\n', encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return `${done.stdout}${done.stderr}`;
}

describe.skipIf(!WINDOWS)('seam-approve.cmd on Windows', () => {
  test('a project folder and a plugin folder with an accent in their names: the script finds both, and runs the window command', () => {
    const base = tempDir();
    const root = join(base, 'projet é');
    const plugin = join(base, 'plugin é');
    put(plugin, 'dist/seam.mjs', "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\n");
    put(root, 'keep.txt', 'x');
    const script = join(base, 'seam-approve.cmd');
    writeFileSync(script, approveScript(root, plugin)); // as installShortcut writes it: UTF-8, no byte-order mark
    const line = runCmd(script).split(/\r?\n/).find((l) => l.startsWith('{'));
    expect(line, 'the stand-in seam.mjs did not run').toBeDefined();
    const seen = JSON.parse(line ?? '{}') as { cwd: string; args: string[] };
    expect(seen.args).toEqual(['window']);
    expect(seen.cwd.toLowerCase()).toBe(root.toLowerCase());
  });

  test('a % in a folder name is not read as a variable', () => {
    const base = tempDir();
    const root = join(base, '100%done');
    put(root, 'keep.txt', 'x');
    const plugin = join(base, '50%plugin');
    put(plugin, 'dist/seam.mjs', "console.log('cwd=' + process.cwd());\n");
    const script = join(base, 'seam-approve.cmd');
    writeFileSync(script, approveScript(root, plugin));
    expect(runCmd(script).toLowerCase()).toContain(`cwd=${root.toLowerCase()}`);
  });

  test('the real script runs the real seam window: with no keyboard it says approvals happen in the Seam Approve window', async () => {
    const app = await makeApp({ phase: 'setup' });
    const script = join(tempDir(), 'seam-approve.cmd');
    writeFileSync(script, approveScript(app.root, REPO));
    expect(runCmd(script)).toContain('approvals happen in the Seam Approve window on your desktop');
  });

  test('a shortcut for a project whose path has an accent points at the script, accents and all', () => {
    const base = tempDir();
    const dataDir = join(base, 'données');
    const root = join(base, 'projet é');
    put(root, 'keep.txt', 'x');
    const desktop = tempDir();
    const made = installShortcut({ root, dataDir, pluginRoot: join(base, 'plugin é'), desktopDir: desktop });
    const read = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${made.link.replace(/'/g, "''")}')`,
      'Write-Output $s.TargetPath',
      'Write-Output $s.WorkingDirectory',
    ].join('; ');
    const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(read, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
    const [target, workDir] = out.stdout.trim().split(/\r?\n/);
    expect(target.toLowerCase()).toBe(made.script.toLowerCase());
    expect(workDir.toLowerCase()).toBe(root.toLowerCase());
  });

  test('a PowerShell failure is a plain message, not CLIXML', () => {
    let message = '';
    try {
      installShortcut({ root: tempDir(), dataDir: tempDir(), pluginRoot: tempDir(), desktopDir: join(tempDir(), 'no', 'such', 'folder') });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/^Could not make the Seam Approve shortcut: /);
    expect(message).not.toMatch(/CLIXML|<Objs|<S S=/);
    expect(message.length).toBeGreaterThan('Could not make the Seam Approve shortcut: '.length);
  });
});
