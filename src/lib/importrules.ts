// Which imports a code file may have: a package the plan lists, a file the plan lists, or something
// its own plan entry names. Anything else is a way to pull in code nobody approved.
import { posix } from 'node:path';
import type { Plan } from '../formats/plan.ts';

const EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const withoutExtension = (path: string): string => path.replace(EXTENSION, '');

/** `lodash/fp` is the package `lodash`; `@scope/pkg/sub` is `@scope/pkg`; `node:fs/promises` is `node:fs`. */
export function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The planned files, and the paths named in this file's own plan entry, spelled from the repo root and from the app folder, without extension (a folder stands for its index file). */
function knownFiles(plan: Plan, named: readonly string[]): Set<string> {
  const found = new Set<string>();
  const paths = [...plan.seams.flatMap((s) => s.files.map((f) => f.path)), ...named];
  for (const path of paths) {
    for (const spelled of [posix.normalize(path), posix.join(plan.appRoot.replace(/\\/g, '/'), path)]) {
      const bare = withoutExtension(posix.normalize(spelled));
      found.add(bare);
      if (posix.basename(bare) === 'index') found.add(posix.dirname(bare));
    }
  }
  return found;
}

/** `./x`, `../x`, `.` and `..`: a path from the importing file. Anything else is a package. */
const RELATIVE = /^\.\.?(?:\/|$)/;

/**
 * Is `spec`, imported by the file at `path` (from the repo root), something the plan allows? A backslash
 * is refused everywhere (the loader may read it as a slash), and so is a package path with an empty, `.`
 * or `..` part, a `node_modules` part or an escape (`react/../lodash` names a package other than `react`),
 * so no path can walk out of the package the plan allows.
 */
export function importAllowed(spec: string, path: string, plan: Plan): boolean {
  if (spec.includes('\\')) return false;
  const own = plan.seams.flatMap((s) => s.files).find((f) => posix.normalize(f.path) === path || posix.join(plan.appRoot, f.path) === path);
  const named = own?.imports ?? [];
  if (RELATIVE.test(spec)) return knownFiles(plan, named).has(withoutExtension(posix.join(posix.dirname(path), spec)));
  if (spec.split('/').some((part) => part === '' || part === '.' || part === '..' || part === 'node_modules' || part.includes('%'))) return false;
  return named.includes(spec) || plan.packages.includes(spec) || plan.packages.includes(packageName(spec));
}
