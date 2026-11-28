// The lock writer. At freeze, every planned code file is fingerprinted by named item (see codeprint.ts)
// and everything else the plan protects is fingerprinted whole. The result is `.seam/lock.json`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../formats/env.ts';
import { LOCK_PATH, parseLock } from '../formats/lock.ts';
import type { FileLock, Lock } from '../formats/lock.ts';
import { PLAN_PATH } from '../formats/plan.ts';
import type { Plan } from '../formats/plan.ts';
import { atomicWrite } from './atomic.ts';
import { fingerprintSource, parseProblem, parseSource } from './codeprint.ts';
import { isScriptPath, locate, wholeFiles } from './lockfiles.ts';
import { withEffectiveRoots } from './roots.ts';
import { requireSeamDir } from './seamdir.ts';
import { hashFile } from './text.ts';

export { fingerprintCode } from './codeprint.ts';
export { hash, hashFile, normalize } from './text.ts';

/** Fingerprint a planned code file. One that doesn't parse can't be fingerprinted, so it is refused, not locked as it is. */
function codeLock(plannedPath: string, key: string, text: string): FileLock {
  const sf = parseSource(key, text);
  const broken = parseProblem(sf);
  if (broken !== null) throw new Error(`${plannedPath} can't be locked: ${broken}`);
  return fingerprintSource(sf);
}

const whole = (abs: string): FileLock => ({ kind: 'whole', hash: hashFile(readFileSync(abs)) });

/**
 * Fingerprint the plan's files and write `<root>/.seam/lock.json`. Every planned file that isn't a
 * config file must be on disk (a missing one throws, naming it). The plan file, the contracts, tests
 * and fixtures folders and the config files get a whole-file hash; planned code files get named items.
 * The tamper check compares files with its own record, not with the lock, so a script that writes the lock must
 * then take a new snapshot (`snapshotProtected`, guard/tamper.ts), or the check puts the new lock.json back.
 * The files are looked for where the app really is: the plan's folder, or env.json's where the plan keeps the default (R81).
 */
export function writeLock(root: string, given: Plan): Lock {
  requireSeamDir(root, "the lock can't be written");
  if (!existsSync(join(root, PLAN_PATH))) throw new Error(`${PLAN_PATH} is missing, so the plan can't be locked.`);
  const plan = withEffectiveRoots(given, loadEnv(root));
  const files = new Map<string, FileLock>();
  for (const seam of plan.seams) {
    for (const planned of seam.files) {
      const at = locate(root, plan.appRoot, planned.path);
      if (!at) {
        if (planned.kind === 'config') continue;
        throw new Error(`${planned.path} is in the plan but isn't on disk, so it can't be locked.`);
      }
      const asCode = planned.kind !== 'config' && isScriptPath(planned.path);
      files.set(at.key, asCode ? codeLock(planned.path, at.key, readFileSync(at.abs, 'utf8')) : whole(at.abs));
    }
  }
  for (const at of wholeFiles(root, plan)) if (!files.has(at.key)) files.set(at.key, whole(at.abs));
  const sorted = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const lock = parseLock({ version: 1, files: Object.fromEntries(sorted) }, 'The lock to write');
  atomicWrite(join(root, LOCK_PATH), `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}
