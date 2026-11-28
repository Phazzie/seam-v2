// After a lost data folder, seam-approve.cmd is lost with it (it lives in the data folder), and the desktop shortcut points at it, so the
// Seam Approve window cannot open. `seam init` run again on the project makes the setup whole and now looks after that:
//  - if the "Seam Approve" shortcut is on the desktop, it writes seam-approve.cmd again (and points the shortcut at it, in case the data
//    folder is somewhere else now);
//  - if it is not, the message says to run `seam install-shortcut` first, and then to open the window and choose "Accept my own edits".
// Nothing here touches the owner's real desktop: the desktop folder is handed in (SEAM_DESKTOP_DIR).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { approveScript, installShortcut } from '../../src/cli/shortcut.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { folderAt, folderOf } from '../helpers/cli.ts';
import { tempDir } from '../helpers/project.ts';

const WINDOWS = process.platform === 'win32';
const WHOLE = /setup was incomplete and is whole again/;

/** A project whose data folder was lost (and so its seam-approve.cmd), and an empty desktop folder to hand in. */
async function lost(): Promise<{ app: App; desktop: string }> {
  const app = await makeApp({ phase: 'build', lock: true });
  const desktop = tempDir();
  rmSync(app.dataDir, { recursive: true, force: true });
  return { app, desktop };
}
const targetOf = (link: string): string => {
  const read = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${link.replace(/'/g, "''")}'); [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $s.TargetPath`;
  const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(read, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  return out.stdout.trim();
};

describe('no shortcut on the desktop', () => {
  test('the message says to run seam install-shortcut first, then to open the window and choose "Accept my own edits"', async () => {
    const { app, desktop } = await lost();
    const init = await folderOf(app).cli(['init'], { SEAM_DESKTOP_DIR: desktop });
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(init.stdout).toMatch(WHOLE);
    expect(init.stdout).toMatch(/First run seam install-shortcut \(from Claude Code\).*then open the window and choose "Accept my own edits"/s);
    expect(existsSync(join(app.dataDir, 'seam-approve.cmd'))).toBe(false);
    expect(init.stdout.indexOf('install-shortcut')).toBeLessThan(init.stdout.indexOf('Accept my own edits'));
  });
});

describe.skipIf(!WINDOWS)('a shortcut on the desktop whose seam-approve.cmd was lost with the data folder', () => {
  test('init writes seam-approve.cmd again, where the shortcut points, and says the shortcut works', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const desktop = tempDir();
    const made = installShortcut({ root: app.root, dataDir: app.dataDir, pluginRoot: app.pluginRoot, desktopDir: desktop });
    rmSync(app.dataDir, { recursive: true, force: true });
    expect(existsSync(made.script)).toBe(false);
    const init = await folderOf(app).cli(['init'], { SEAM_DESKTOP_DIR: desktop });
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(init.stdout).toMatch(WHOLE);
    expect(init.stdout).toMatch(/shortcut on your desktop works again/);
    expect(init.stdout).not.toMatch(/First run seam install-shortcut/);
    expect(readFileSync(made.script, 'utf8')).toBe(approveScript(app.root, app.pluginRoot));
    expect(targetOf(made.link).toLowerCase()).toBe(made.script.toLowerCase());
  });

  test('and when the data folder is somewhere else now, the shortcut is pointed at the new seam-approve.cmd', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const desktop = tempDir();
    const made = installShortcut({ root: app.root, dataDir: app.dataDir, pluginRoot: app.pluginRoot, desktopDir: desktop });
    rmSync(app.dataDir, { recursive: true, force: true });
    const fresh = join(tempDir(), 'data');
    const init = await folderAt(app.root, fresh, app.pluginRoot).cli(['init'], { SEAM_DESKTOP_DIR: desktop });
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    const script = join(fresh, 'seam-approve.cmd');
    expect(existsSync(script)).toBe(true);
    expect(targetOf(made.link).toLowerCase()).toBe(script.toLowerCase());
  });

  test('a shortcut that is not there is not made by init (that is install-shortcut\'s job), whatever else is on the desktop', async () => {
    const { app, desktop } = await lost();
    const init = await folderOf(app).cli(['init'], { SEAM_DESKTOP_DIR: desktop });
    expect(init.exitCode).toBe(0);
    expect(existsSync(join(desktop, 'Seam Approve.lnk'))).toBe(false);
  });
});
