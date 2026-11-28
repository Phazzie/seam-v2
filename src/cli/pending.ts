// The request the owner is asked to approve: `.seam/pending.json` = `{ kind, code, summary, fingerprints }`. The main
// AI writes it (`seam request <kind>`); only `seam approve`, run by the owner in the approval window, acts on it. The
// fingerprints are what was shown: the plan, and every file the freeze would lock, as they were when it was asked for.
// If any of them is different at approval, or one is new or gone, the request is stale and has to be asked for again.
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { loadEnv } from '../formats/env.ts';
import { PLAN_PATH } from '../formats/plan.ts';
import type { Plan } from '../formats/plan.ts';
import { loadJson } from '../formats/read.ts';
import { ApprovalRecordSchema } from '../formats/state.ts';
import { locate, wholeFiles } from '../lib/lockfiles.ts';
import type { Located } from '../lib/lockfiles.ts';
import { withEffectiveRoots } from '../lib/roots.ts';
import { hashFile } from '../lib/text.ts';
import type { Ctx } from '../types.ts';
import type { Kind } from './moves.ts';

export const PENDING_PATH = '.seam/pending.json';
/** No I, L, O, 0 or 1: nothing in it can be misread from a screen. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

export const PendingSchema = z.strictObject({
  kind: ApprovalRecordSchema.shape.kind,
  code: z.string(),
  summary: z.string(),
  fingerprints: z.record(z.string(), z.string()),
});
export type Pending = z.infer<typeof PendingSchema>;

/** A fresh code: 4 characters of the alphabet, from the system's random source. */
export function newCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/** The waiting request, or null if there is none. Throws, in plain words, if the file is there and unreadable. */
export const loadPending = (root: string): Pending | null => loadJson(PendingSchema, root, PENDING_PATH);

/** The planned code files that are not on disk (config files may be absent; the plan says so). They are looked for where the app really is (R81). */
export function missingPlanned(root: string, plan: Plan): string[] {
  const { appRoot, seams } = withEffectiveRoots(plan, loadEnv(root));
  return seams.flatMap((seam) => seam.files).filter((f) => f.kind !== 'config' && locate(root, appRoot, f.path) === null).map((f) => f.path);
}

/**
 * What a request is about, as a hash for each file: with a plan, everything the freeze would lock (the plan, the planned
 * files that are there, the contracts, tests and fixtures, the config files); with none yet, the plan file if there is one.
 * Keys are paths from the repo root, in order, so two sets that say the same compare as equal. The files are looked for where the
 * app really is, as the lock will (R81).
 */
export function fingerprintsOf(root: string, plan: Plan | null): Record<string, string> {
  const files = new Map<string, string>();
  const add = ({ abs, key }: Located): void => void files.set(key, hashFile(readFileSync(abs)));
  if (plan === null) {
    const abs = join(root, PLAN_PATH);
    if (existsSync(abs)) add({ abs, key: PLAN_PATH });
  } else {
    const placed = withEffectiveRoots(plan, loadEnv(root));
    for (const planned of placed.seams.flatMap((seam) => seam.files)) {
      const at = locate(root, placed.appRoot, planned.path);
      if (at !== null) add(at);
    }
    wholeFiles(root, placed).forEach(add);
  }
  return Object.fromEntries([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * What a request of `kind` is about: the plan and what the freeze would lock; for an edit nothing, since the owner makes the changes
 * after it is asked for (R77: the window lists what differs when it opens, and approving takes exactly that), so it can never go stale.
 */
export function fingerprintsFor(ctx: Ctx, kind: Kind): Record<string, string> {
  return kind === 'edit' ? {} : fingerprintsOf(ctx.root, ctx.plan);
}

/** Do two sets of fingerprints name the same files with the same hashes? */
export function sameFingerprints(a: Record<string, string>, b: Record<string, string>): boolean {
  const left = Object.entries(a).sort(([x], [y]) => (x < y ? -1 : 1));
  const right = Object.entries(b).sort(([x], [y]) => (x < y ? -1 : 1));
  return left.length === right.length && left.every(([key, hash], i) => key === right[i][0] && hash === right[i][1]);
}
