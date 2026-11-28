// R81 (Codex on PR #25, P2): the approval launcher was one file for the whole data folder (seam-approve.cmd) and one desktop shortcut
// ("Seam Approve"), so a second project sharing the plugin's data folder overwrote the first one's: its shortcut then opened the second
// project's window. Each project now has its own launcher, seam-approve-<rootKey>.cmd, and its own shortcut, "Seam Approve - <folder name>"
// (with a short key added when two projects have the same folder name). A launcher and shortcut of the old single name are replaced when
// they point at THIS project and left alone when they point at another. Nothing here touches the real desktop: it is handed in.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { approveScript, installShortcut, launchedByShortcut } from '../../src/cli/shortcut.ts';
import { findLink } from '../../src/cli/shortcutlink.ts';
import { crowdedNameFor, OLD_SCRIPT_NAME, scriptNameFor, scriptPathFor, shortcutNameFor } from '../../src/cli/shortcutnames.ts';
import { rootKey } from '../../src/lib/store.ts';
import { put, tempDir } from '../helpers/project.ts';

const WINDOWS = process.platform === 'win32';
const row = (name: string, commandLine: string) => ({ name, commandLine });

/** A folder called `name` somewhere of its own, with a file in it. */
function project(name: string): string {
  const root = join(tempDir(), name);
  put(root, 'keep.txt', 'x');
  return root;
}

describe('the names', () => {
  test('the launcher is named for the project, the same for every spelling of its folder', () => {
    const root = project('shop');
    expect(scriptNameFor(root)).toBe(`seam-approve-${rootKey(root)}.cmd`);
    expect(scriptNameFor(root)).toBe(scriptNameFor(`${root}${process.platform === 'win32' ? '\\' : '/'}.`));
    expect(scriptNameFor(project('shop'))).not.toBe(scriptNameFor(root));
    expect(scriptPathFor('D:\\data', root)).toBe(join('D:\\data', scriptNameFor(root)));
    expect(scriptNameFor(root)).not.toBe(OLD_SCRIPT_NAME);
  });

  test('the shortcut is named for the folder; when two projects have one folder name, the second adds a short key', () => {
    const root = project('my shop');
    expect(shortcutNameFor(root)).toBe('Seam Approve - my shop');
    expect(crowdedNameFor(root)).toBe(`Seam Approve - my shop (${rootKey(root).slice(0, 6)})`);
  });

  test('the shortcut of a project at the root of a drive still has a name', () => {
    expect(shortcutNameFor('C:\\')).toBe('Seam Approve - project');
  });

  test('a window opened from one project\'s launcher is not accepted for another\'s, and the old single-name launcher is not accepted for either', () => {
    const [a, b] = [project('shop'), project('shop')];
    const data = tempDir();
    const viaA = [row('cmd.exe', `cmd /c ""${scriptPathFor(data, a)}" "`)];
    expect(launchedByShortcut(scriptPathFor(data, a), () => viaA, 'win32')).toBe(true);
    expect(launchedByShortcut(scriptPathFor(data, b), () => viaA, 'win32')).toBe(false);
    const viaOld = [row('cmd.exe', `cmd /c ""${join(data, OLD_SCRIPT_NAME)}" "`)];
    expect(launchedByShortcut(scriptPathFor(data, a), () => viaOld, 'win32')).toBe(false);
  });
});

/** The target and the working folder of a shortcut, read back through Windows. */
function readLink(link: string): { target: string; workDir: string } {
  const read = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $s = (New-Object -ComObject WScript.Shell).CreateShortcut('${link.replace(/'/g, "''")}'); Write-Output $s.TargetPath; Write-Output $s.WorkingDirectory`;
  const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(read, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  const [target = '', workDir = ''] = out.stdout.trim().split(/\r?\n/);
  return { target, workDir };
}
const lnks = (desktop: string): string[] => readdirSync(desktop).filter((n) => n.endsWith('.lnk')).sort();
const install = (root: string, dataDir: string, desktop: string) => installShortcut({ root, dataDir, pluginRoot: tempDir(), desktopDir: desktop });
/** What the old version left: seam-approve.cmd in the data folder, and "Seam Approve.lnk" on the desktop pointing at it and working in `root`. */
function leaveOldFiles(root: string, dataDir: string, desktop: string): { script: string; link: string } {
  const script = join(dataDir, OLD_SCRIPT_NAME);
  put(dataDir, OLD_SCRIPT_NAME, 'x');
  writeFileSync(script, approveScript(root, tempDir()));
  const link = join(desktop, 'Seam Approve.lnk');
  const make = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${link.replace(/'/g, "''")}'); $s.TargetPath = '${script.replace(/'/g, "''")}'; $s.WorkingDirectory = '${root.replace(/'/g, "''")}'; $s.Save()`;
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(make, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  expect(existsSync(link)).toBe(true);
  return { script, link };
}

describe.skipIf(!WINDOWS)('two projects sharing one data folder, on Windows', () => {
  test('each keeps its own launcher and its own shortcut: the second install does not take over the first', () => {
    const [a, b] = [project('shop'), project('blog')];
    const [data, desktop] = [tempDir(), tempDir()];
    const first = install(a, data, desktop);
    const second = install(b, data, desktop);
    expect(first.script).toBe(scriptPathFor(data, a));
    expect(second.script).toBe(scriptPathFor(data, b));
    expect(first.link).toBe(join(desktop, 'Seam Approve - shop.lnk'));
    expect(second.link).toBe(join(desktop, 'Seam Approve - blog.lnk'));
    expect(readFileSync(first.script, 'utf8')).toContain(`cd /d "${a}"`);
    expect(readFileSync(second.script, 'utf8')).toContain(`cd /d "${b}"`);
    expect(readLink(first.link)).toEqual({ target: first.script, workDir: a });
    expect(readLink(second.link)).toEqual({ target: second.script, workDir: b });
    expect(lnks(desktop)).toEqual(['Seam Approve - blog.lnk', 'Seam Approve - shop.lnk']);
  });

  test('installing again for the same project replaces its own files and makes no extra ones', () => {
    const a = project('shop');
    const [data, desktop] = [tempDir(), tempDir()];
    install(a, data, desktop);
    install(a, data, desktop);
    expect(lnks(desktop)).toEqual(['Seam Approve - shop.lnk']);
    expect(readdirSync(data)).toEqual([scriptNameFor(a)]);
  });

  test('two projects with the same folder name get two shortcuts the owner can tell apart, and each reinstall finds its own', () => {
    const [a, b] = [project('shop'), project('shop')];
    const [data, desktop] = [tempDir(), tempDir()];
    const first = install(a, data, desktop);
    const second = install(b, data, desktop);
    expect(first.link).toBe(join(desktop, 'Seam Approve - shop.lnk'));
    expect(second.link).toBe(join(desktop, `${crowdedNameFor(b)}.lnk`));
    install(a, data, desktop);
    install(b, data, desktop);
    expect(lnks(desktop)).toHaveLength(2);
    expect(readLink(first.link).workDir).toBe(a);
    expect(readLink(second.link).workDir).toBe(b);
  });

  test('findLink gives the project\'s own shortcut, not another project\'s of the same folder name', () => {
    const [a, b] = [project('shop'), project('shop')];
    const [data, desktop] = [tempDir(), tempDir()];
    expect(findLink(a, desktop)).toBeNull();
    const first = install(a, data, desktop);
    expect(findLink(a, desktop)).toBe(first.link);
    expect(findLink(b, desktop)).toBeNull();
    const second = install(b, data, desktop);
    expect(findLink(b, desktop)).toBe(second.link);
    expect(findLink(a, desktop)).toBe(first.link);
  });
});

describe.skipIf(!WINDOWS)('the old single-name launcher and shortcut, on Windows', () => {
  test('they point at this project: they are replaced by its own', () => {
    const a = project('shop');
    const [data, desktop] = [tempDir(), tempDir()];
    const old = leaveOldFiles(a, data, desktop);
    expect(findLink(a, desktop)).toBe(old.link); // it is this project's shortcut, and init may treat it as such
    const made = install(a, data, desktop);
    expect(existsSync(old.script)).toBe(false);
    expect(existsSync(old.link)).toBe(false);
    expect(existsSync(made.script)).toBe(true);
    expect(lnks(desktop)).toEqual(['Seam Approve - shop.lnk']);
  });

  test('they point at another project: they are left alone (and are not this project\'s shortcut)', () => {
    const [a, other] = [project('shop'), project('blog')];
    const [data, desktop] = [tempDir(), tempDir()];
    const old = leaveOldFiles(other, data, desktop);
    const script = readFileSync(old.script, 'utf8');
    expect(findLink(a, desktop)).toBeNull();
    const made = install(a, data, desktop);
    expect(readFileSync(old.script, 'utf8')).toBe(script);
    expect(existsSync(old.link)).toBe(true);
    expect(readLink(old.link).workDir).toBe(other);
    expect(lnks(desktop)).toEqual(['Seam Approve - shop.lnk', 'Seam Approve.lnk']);
    expect(existsSync(made.script)).toBe(true);
  });

  test('one that points at this project and one that points at another: only this project\'s is replaced', () => {
    const [a, other] = [project('shop'), project('blog')];
    const [data, desktop] = [tempDir(), tempDir()];
    leaveOldFiles(other, data, desktop); // the old launcher in this data folder is the other project's
    const mine = leaveOldFiles(a, tempDir(), desktop); // the old shortcut on the desktop is this project's (its launcher was in a different data folder)
    install(a, data, desktop);
    expect(existsSync(mine.link)).toBe(false); // the old shortcut was this project's: replaced
    expect(readFileSync(join(data, OLD_SCRIPT_NAME), 'utf8')).toContain(`cd /d "${other}"`); // the old launcher in this data folder was another's: kept
  });
});
