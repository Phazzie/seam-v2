// R57 (narrows R48): outside the project the main AI may write only in the temp folder. Everything else out there
// is out of the project's reach on purpose: git, npm and shell settings in the home folder make programs run.
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { describe, expect, test } from 'vitest';
import { asMain } from '../helpers/app.ts';
import { ask, isAllowed, reasonOf, scene, theBuilder } from '../helpers/decide.ts';
import type { Scene } from '../helpers/decide.ts';

const ONLY_TEMP = 'outside the project, only the temp folder is writable';
const write = (s: Scene, file: string, who = asMain(), tool = 'Write') =>
  ask(s, tool, tool === 'Write' ? { file_path: file, content: 'x\n' } : { file_path: file, old_string: 'a', new_string: 'b' }, who);

describe('R57: the main AI cannot write the settings that live outside the project', () => {
  const HOME = homedir();
  const SETTINGS: [string, string][] = [
    ['~/.gitconfig', join(HOME, '.gitconfig')],
    ['~/.config/git/config', join(HOME, '.config', 'git', 'config')],
    ['~/.config/git/ignore', join(HOME, '.config', 'git', 'ignore')],
    ['~/.npmrc', join(HOME, '.npmrc')],
    ['~/.bashrc', join(HOME, '.bashrc')],
    ['~/.bash_profile', join(HOME, '.bash_profile')],
    ['~/.profile', join(HOME, '.profile')],
    ['~/.zshrc', join(HOME, '.zshrc')],
    ['the PowerShell profile (PowerShell 7)', join(HOME, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1')],
    ['the PowerShell profile (Windows PowerShell)', join(HOME, 'Documents', 'WindowsPowerShell', 'profile.ps1')],
    ['a startup folder script', join(HOME, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'x.cmd')],
    ['a note in the home folder', join(HOME, 'notes.md')],
    ['a file next to the temp folder', join(dirname(tmpdir()), 'seam-not-temp.txt')],
    ['a file reached from the temp folder by ..', join(tmpdir(), '..', 'seam-not-temp.txt')],
    ['a file on the drive root', join(parse(HOME).root, 'seam-not-temp.txt')],
  ];
  test.each(SETTINGS)('%s', async (_what, file) => {
    const s = await scene();
    expect(await reasonOf(write(s, file))).toBe(ONLY_TEMP);
    expect(await reasonOf(write(s, file, asMain(), 'Edit'))).toBe(ONLY_TEMP);
  });

  test('a write that names one of them with another file in the temp folder is refused for it', async () => {
    const s = await scene();
    const both = { file_path: join(tmpdir(), 'seam-ok.txt'), notebook_path: join(HOME, '.gitconfig'), content: 'x' };
    expect(await reasonOf(ask(s, 'Write', both, asMain()))).toBe(ONLY_TEMP);
  });
});

describe('R57: the temp folder is writable', () => {
  test.each([
    ['a file in it', () => join(tmpdir(), 'seam-write-test', 'notes.txt')],
    ['a new folder in it', () => join(tmpdir(), 'seam-new-folder', 'deep', 'er', 'x.md')],
    ['a file in it spelled with ..', () => join(tmpdir(), 'a', '..', 'b.txt')],
  ])('%s', async (_what, file) => {
    const s = await scene();
    await isAllowed(write(s, file()));
    await isAllowed(write(s, file(), asMain(), 'Edit'));
  });

  test('a protected place inside the temp folder is still protected (the project may be there too)', async () => {
    const s = await scene();
    expect(await reasonOf(write(s, join(s.app.dataDir, 'projects.json')))).toMatch(/protected/);
    expect(await reasonOf(write(s, join(s.app.pluginRoot, 'dist', 'hook.mjs')))).toMatch(/plugin's own files/);
  });

  test('a builder still may not write outside the project, even in the temp folder', async () => {
    const s = await scene();
    expect(await reasonOf(write(s, join(tmpdir(), 'seam-write-test', 'notes.txt'), theBuilder()))).toMatch(/only the main AI may write outside the project/);
  });
});
