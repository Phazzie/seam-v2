// A plain error when `.seam/` is not there, so a write never invents a half project (a mirror, a
// log) for a folder that is not a seam project, and the owner never reads a raw ENOENT.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Throw "The seam records folder is missing (...), so <why>." unless `<root>/.seam` exists. */
export function requireSeamDir(root: string, why: string): void {
  const dir = join(root, '.seam');
  if (!existsSync(dir)) throw new Error(`The seam records folder is missing (${dir}), so ${why}.`);
}
