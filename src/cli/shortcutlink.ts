// The desktop shortcut files (R81): making this project's shortcut, finding it, and dealing with the old single-name files. A shortcut is
// "this project's" if it works in the project's folder (the working folder it was made with), so two projects that share a data folder or
// a folder name are never mistaken for each other.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { scriptGoesTo } from './approvescript.ts';
import { powershell, quoted } from './powershell.ts';
import { crowdedNameFor, OLD_SCRIPT_NAME, OLD_SHORTCUT_NAME, shortcutNameFor } from './shortcutnames.ts';

/** PowerShell: `Mine $path` is true if a shortcut is there and works in `root`. */
const mine = (root: string): string =>
  `$sh = New-Object -ComObject WScript.Shell; function Mine($p) { (Test-Path -LiteralPath $p) -and ($sh.CreateShortcut($p).WorkingDirectory -eq ${quoted(root)}) }`;

/** The three file names a shortcut of this project's can have, best first: its own, the one with a key, the old single name. */
const namesFor = (root: string): string[] => [shortcutNameFor(root), crowdedNameFor(root), OLD_SHORTCUT_NAME].map((name) => `${name}.lnk`);

/**
 * Make this project's shortcut to `script`, on the desktop (a PowerShell expression for the folder). Its own name, or the one with a key
 * if that is taken by another project's. The old single-name shortcut goes if it is this project's, and stays if it is another's.
 * Returns where it is.
 */
export function makeLink(o: { root: string; script: string; desktop: string }): string {
  const [plain, crowded, old] = namesFor(o.root).map(quoted);
  return powershell([
    "$ErrorActionPreference = 'Stop'",
    mine(o.root),
    `$desktop = (${o.desktop})`,
    `$link = Join-Path $desktop ${plain}`,
    `if ((Test-Path -LiteralPath $link) -and -not (Mine $link)) { $link = Join-Path $desktop ${crowded} }`,
    '$s = $sh.CreateShortcut($link)',
    `$s.TargetPath = ${quoted(o.script)}`,
    `$s.WorkingDirectory = ${quoted(o.root)}`,
    `$s.Description = ${quoted('Approve the next big step of a Seam project')}`,
    '$s.Save()',
    `$old = Join-Path $desktop ${old}`,
    'if (Mine $old) { Remove-Item -LiteralPath $old }',
    'Write-Output $link',
  ].join('; '), 'make the Seam Approve shortcut').trim();
}

/** Where this project's shortcut is on the desktop `desktop` (a folder), or null if it has none. The old single-name one counts if it is this project's. */
export function findLink(root: string, desktop: string): string | null {
  const names = namesFor(root).map(quoted).join(', ');
  const found = powershell([
    "$ErrorActionPreference = 'Stop'",
    mine(root),
    `$desktop = ${quoted(desktop)}`,
    `foreach ($name in @(${names})) { $p = Join-Path $desktop $name; if (Mine $p) { Write-Output $p; break } }`,
  ].join('; '), 'look for the Seam Approve shortcut').trim();
  return found === '' ? null : found;
}

/** Remove the old single launcher in the data folder if it takes the window to this project; leave it if it takes it to another's. */
export function dropOldScript(dataDir: string, root: string): void {
  const old = join(dataDir, OLD_SCRIPT_NAME);
  if (existsSync(old) && scriptGoesTo(readFileSync(old, 'utf8'), root)) rmSync(old);
}
