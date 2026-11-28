// The "Seam Approve" desktop shortcut (Task 13): `seam install-shortcut` writes seam-approve.cmd into the data folder and a
// shortcut to it on the desktop, and `seam approve` accepts only a window that was opened from that file (the parent
// chain of the process holds a cmd.exe whose command line names it). Nothing here touches the owner's real desktop: the
// desktop folder is handed in. The checks that need Windows are skipped elsewhere.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { approveScript, installShortcut, launchedByShortcut, parseChain, shortcutInChain } from '../../src/cli/shortcut.ts';
import { makeApp } from '../helpers/app.ts';
import { folderOf } from '../helpers/cli.ts';
import { put, tempDir } from '../helpers/project.ts';

const WINDOWS = process.platform === 'win32';
const SCRIPT = 'C:\\Users\\owner\\.claude\\plugins\\data\\seam-v2\\seam-approve.cmd';
const row = (name: string, commandLine: string) => ({ name, commandLine });

describe('seam-approve.cmd', () => {
  test('R77: switches the console to UTF-8, goes to the project, runs the window, and waits so the owner can read the answer', () => {
    expect(approveScript('C:\\work\\my app', 'C:\\plugins\\seam-v2')).toBe(
      ['@echo off', 'chcp 65001 >nul', 'cd /d "C:\\work\\my app"', 'node "C:\\plugins\\seam-v2\\dist\\seam.mjs" window', 'pause', ''].join('\r\n'),
    );
  });

  test('a % in a folder name is doubled, so cmd does not read it as a variable: in the project\'s path and in the plugin\'s', () => {
    expect(approveScript('C:\\100%real', 'C:\\p')).toContain('cd /d "C:\\100%%real"');
    expect(approveScript('C:\\r', 'C:\\100%plugin')).toContain('node "C:\\100%%plugin\\dist\\seam.mjs" window');
  });

  test('a folder name that could end the quote or the line is refused, in either path', () => {
    expect(() => approveScript('C:\\a"b', 'C:\\p')).toThrow(/can't be used/);
    expect(() => approveScript('C:\\a\nb', 'C:\\p')).toThrow(/can't be used/);
    expect(() => approveScript('C:\\r', 'C:\\a"b')).toThrow(/can't be used/);
    expect(() => approveScript('C:\\r', 'C:\\a\rb')).toThrow(/can't be used/);
  });
});

describe('which window counts: a cmd.exe that was run on the installed seam-approve.cmd', () => {
  test('the parent chain is read from "name<TAB>command line" rows', () => {
    expect(parseChain('node.exe\tnode seam.mjs approve\r\ncmd.exe\tC:\\WINDOWS\\system32\\cmd.exe /c ""x.cmd" "\r\n\r\n')).toEqual([
      row('node.exe', 'node seam.mjs approve'), row('cmd.exe', 'C:\\WINDOWS\\system32\\cmd.exe /c ""x.cmd" "'),
    ]);
  });

  test.each([
    ['the shortcut, as Windows runs it', [row('cmd.exe', `C:\\WINDOWS\\system32\\cmd.exe /c ""${SCRIPT}" "`), row('explorer.exe', 'C:\\Windows\\explorer.exe')]],
    ['other spelling: case and slashes', [row('CMD.EXE', `cmd /c ${SCRIPT.toLowerCase().replace(/\\/g, '/')}`)]],
    ['a cmd.exe higher up the chain', [row('node.exe', 'node x'), row('powershell.exe', 'powershell'), row('cmd.exe', `cmd /c ${SCRIPT}`)]],
  ])('yes: %s', (_what, rows) => {
    expect(shortcutInChain(rows, SCRIPT)).toBe(true);
  });

  test.each([
    ['an ordinary terminal', [row('node.exe', 'node dist/seam.mjs approve'), row('cmd.exe', 'C:\\WINDOWS\\system32\\cmd.exe'), row('explorer.exe', 'explorer')]],
    ['node run on the file (not cmd.exe)', [row('node.exe', `node ${SCRIPT}`)]],
    ['a PowerShell that names the file (not cmd.exe)', [row('powershell.exe', `powershell -Command "& '${SCRIPT}'"`)]],
    ['another cmd file', [row('cmd.exe', 'cmd /c C:\\somewhere\\other.cmd')]],
    ['another folder\'s seam-approve.cmd', [row('cmd.exe', 'cmd /c C:\\elsewhere\\seam-approve.cmd')]],
    ['nothing', []],
  ])('no: %s', (_what, rows) => {
    expect(shortcutInChain(rows, SCRIPT)).toBe(false);
  });

  test('off Windows the answer is no, and nothing is looked up', () => {
    let looked = false;
    expect(launchedByShortcut(SCRIPT, () => { looked = true; return [row('cmd.exe', SCRIPT)]; }, 'linux')).toBe(false);
    expect(looked).toBe(false);
  });

  test('on Windows the parent chain from this process\'s parent is asked for, and read', () => {
    const asked: number[] = [];
    expect(launchedByShortcut(SCRIPT, (pid) => { asked.push(pid); return [row('cmd.exe', `cmd /c ${SCRIPT}`)]; }, 'win32')).toBe(true);
    expect(asked).toEqual([process.ppid]);
  });
});

describe.skipIf(!WINDOWS)('on Windows, for real', () => {
  const probe = (): { dir: string; script: string; run: (viaShortcut: boolean) => string } => {
    const dir = tempDir();
    const script = join(dir, 'seam-approve.cmd');
    const shortcutModule = pathToFileURL(resolve(import.meta.dirname, '../../src/cli/shortcut.ts')).href;
    put(dir, 'probe.mjs', `import { launchedByShortcut } from ${JSON.stringify(shortcutModule)};\nconsole.log('answer=' + launchedByShortcut(process.argv[2]));\n`);
    put(dir, 'seam-approve.cmd', `@echo off\r\nnode "${join(dir, 'probe.mjs')}" "${script}"\r\n`);
    const run = (viaShortcut: boolean): string => {
      const done = viaShortcut
        ? spawnSync('cmd.exe', ['/c', script], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
        : spawnSync(process.execPath, [join(dir, 'probe.mjs'), script], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
      return `${done.stdout}${done.stderr}`;
    };
    return { dir, script, run };
  };

  test('a window opened by running the installed file is the shortcut; the same code run any other way is not', () => {
    const p = probe();
    expect(p.run(true)).toContain('answer=true');
    expect(p.run(false)).toContain('answer=false');
  });

  test('install-shortcut writes seam-approve.cmd into the data folder and a "Seam Approve" shortcut to it in the desktop folder it is given', async () => {
    const app = await makeApp({ phase: 'setup' });
    const desktop = tempDir();
    const made = installShortcut({ root: app.root, dataDir: app.dataDir, pluginRoot: app.pluginRoot, desktopDir: desktop });
    expect(made.script).toBe(join(app.dataDir, 'seam-approve.cmd'));
    expect(readFileSync(made.script, 'utf8')).toBe(approveScript(app.root, app.pluginRoot));
    expect(made.link).toBe(join(desktop, 'Seam Approve.lnk'));
    expect(existsSync(made.link)).toBe(true);
    const target = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject WScript.Shell).CreateShortcut('${made.link}').TargetPath`], { encoding: 'utf8', windowsHide: true });
    expect(target.stdout.trim().toLowerCase()).toBe(made.script.toLowerCase());
  });

  test('through the command: the desktop folder is taken from SEAM_DESKTOP_DIR, and the owner is told in plain words', async () => {
    const app = await makeApp({ phase: 'setup' });
    const desktop = tempDir();
    const r = await folderOf(app).cli(['install-shortcut'], { SEAM_DESKTOP_DIR: desktop });
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(existsSync(join(desktop, 'Seam Approve.lnk'))).toBe(true);
    expect(existsSync(join(app.dataDir, 'seam-approve.cmd'))).toBe(true);
    expect(r.stdout).toMatch(/Seam Approve/);
    expect(r.stdout).toMatch(/desktop/);
  });

  test('running it again replaces the shortcut (and points it at the project it was run from)', async () => {
    const app = await makeApp({ phase: 'setup' });
    const other = await makeApp({ phase: 'setup' });
    const desktop = tempDir();
    installShortcut({ root: app.root, dataDir: app.dataDir, pluginRoot: app.pluginRoot, desktopDir: desktop });
    installShortcut({ root: other.root, dataDir: app.dataDir, pluginRoot: app.pluginRoot, desktopDir: desktop });
    expect(readFileSync(join(app.dataDir, 'seam-approve.cmd'), 'utf8')).toContain(other.root);
  });
});
