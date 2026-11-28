// What a project's launcher (seam-approve-<rootKey>.cmd) holds, and how to tell which project a launcher goes to.
import { win32 } from 'node:path';

/** A path as it goes inside quotes in a .cmd file: a quote or a line break cannot, and cmd reads `%name%` as a variable, so `%` is doubled. */
function forCmd(path: string): string {
  if (/["\r\n\0]/.test(path)) throw new Error(`The folder ${JSON.stringify(path)} can't be used in the shortcut's script (a quote or a line break in its name).`);
  return path.replace(/%/g, '%%');
}

/** The line that takes the launcher to the project. */
const goesTo = (root: string): string => `cd /d "${forCmd(root)}"`;

/**
 * What the launcher holds: switch the console to UTF-8 (the file is UTF-8, and cmd reads it in the console's code page, so a
 * path with an accent would break), go to the project, run the window, and wait so the owner can read the answer.
 */
export function approveScript(root: string, pluginRoot: string): string {
  const seam = win32.join(pluginRoot, 'dist', 'seam.mjs');
  return ['@echo off', 'chcp 65001 >nul', goesTo(root), `node "${forCmd(seam)}" window`, 'pause', ''].join('\r\n');
}

/** Does this launcher text take the window to `root`? (How the old single launcher is told to be this project's or another's.) */
export const scriptGoesTo = (text: string, root: string): boolean => {
  const want = goesTo(root).toLowerCase();
  return text.split(/\r?\n/).some((line) => line.toLowerCase() === want);
};
