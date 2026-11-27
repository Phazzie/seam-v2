// Walking the project for the tamper check: every file that is protected, and every code file that
// is not (so a new one can be told from one that was there). It never asks git and never looks up a real
// path per file, so it is fast enough to run after a command; only a code file nobody knew goes on to the
// full classify (which asks git whether it is ignored).
import { readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { errorCode } from '../lib/atomic.ts';
import { inBuildOutput, isCodeFile, placesOf, protectedClass, rel, resolveReal } from '../lib/paths.ts';
import type { PathClass } from '../lib/paths.ts';
import type { Ctx } from '../types.ts';
import { fold } from './tamperrecord.ts';

/** A file the walk found: its path from the repo root, where it is, and the protected place it sits in (null for a code file nothing protects). */
export interface Walked { key: string; abs: string; cls: PathClass | null }

/**
 * What the guard writes itself while it works (R22, and the record of calls under way): the lock, its guard, the
 * log, the heartbeat, the temp files of an atomic write, and state.json (checked against its copy, not here).
 */
const OWN = /^\.seam\/(?:\.lock(?:\.break)?|log\.md|heartbeat\.json|inflight|state\.json|.*\.tmp)$/i;
/** Folders a tool fills and nobody protects, wherever they are (R22). */
const NEVER = new Set(['.git', 'node_modules']);

/** Is this path (from the repo root) one the guard keeps out of the record? */
export const isOwn = (key: string): boolean => OWN.test(key);

/**
 * Call `visit` for each file under the project that is protected, or that is a code file nothing protects. Links
 * are not followed. The data folder, the plugin folder, `.git`, `node_modules` and build output are skipped.
 */
export function walkRepo(ctx: Ctx, visit: (file: Walked) => void): void {
  const places = placesOf(ctx);
  const apart = [ctx.dataDir, ctx.pluginRoot].map((dir) => resolveReal(dir, '.'));
  const spelled = (key: string): string => `${places.root.endsWith('/') ? places.root : `${places.root}/`}${fold(key)}`;

  const inside = (dir: string, key: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return; // gone since its parent was listed
      throw err;
    }
    for (const e of entries) {
      const key2 = key === '' ? e.name : `${key}/${e.name}`;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        const p = spelled(key2);
        if (NEVER.has(e.name) || apart.includes(p) || inBuildOutput(fold(key2), rel(places.appDir, p))) continue;
        inside(abs, key2);
      } else if (e.isFile() && !isOwn(key2)) {
        const p = spelled(key2);
        const cls = protectedClass(ctx, places, p, fold(key2));
        if (cls === 'generated') continue;
        if (cls !== null || isCodeFile(rel(places.appDir, p) ?? fold(key2))) visit({ key: key2, abs, cls });
      }
    }
  }
  inside(ctx.root, '');
}
