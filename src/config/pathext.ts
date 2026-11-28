// The file extensions this machine runs by name (R62): Windows' PATHEXT. cmd.exe looks in the current folder for
// `vitest` plus each of them, so a file with one of them, written into the project, is run by `npm test`. The list
// differs from machine to machine (`.cpl` is on some), so it is read here, with the rest of what the guard takes from
// the environment (only src/config reads it), and the classifier counts every one of them as code.

let seen: string | undefined;
let extensions: ReadonlySet<string> = new Set();

/** The extensions in PATHEXT, lower case with their dot (`.com`, `.exe`, ...). None when PATHEXT is not set (other systems). */
export function runnableExtensions(): ReadonlySet<string> {
  const text = process.env.PATHEXT ?? '';
  if (text !== seen) {
    seen = text;
    extensions = new Set(text.split(';').map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 1 && entry.startsWith('.')));
  }
  return extensions;
}
