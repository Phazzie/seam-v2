// Shared set-up for the lock check tests: the practice plan, a lock made from the skeleton of
// total.ts, and short ways to bend the filled-in total.
import { expect } from 'vitest';
import type { Lock } from '../../src/formats/lock.ts';
import { loadPlan } from '../../src/formats/plan.ts';
import type { Plan } from '../../src/formats/plan.ts';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { FIXTURE, TOTAL, planFile, skeleton, total } from './code.ts';

export const P = TOTAL;
export const plan: Plan = loadPlan(FIXTURE)!;
export const { seam, file } = planFile(TOTAL);
export const FILLED = total();
export const [S1, S2, S3] = file.steps;
export const HEADER_END = ' */\n';

/** A lock that covers `path` as it is in `text`. */
export const lockFor = (path: string, text: string): Lock => ({ version: 1, files: { [path]: fingerprintCode(path, text) } });
export const lockOf = (text: string): Lock => lockFor(P, text);
export const lock = lockOf(skeleton(seam, file));

/** The problems with `proposed` as total.ts, against the skeleton lock unless another is given. */
export const check = (proposed: string, against = lock, using = plan): string[] => checkAgainstLock(P, proposed, against, using);

/** `FILLED` with `from` replaced by `to`; fails the test if `from` isn't in it. */
export function edit(from: string, to: string): string {
  expect(FILLED, `the sample has no "${from}" to change`).toContain(from);
  return FILLED.replace(from, to);
}

/** `FILLED` without its step 2 marker line, the place the bypass tests start from. */
export const withoutStep2 = (): string => edit(`  // Step 2: ${S2}\n`, '');
/** The three marker lines of the filled total, as a function body. */
export const MARKERS = [S1, S2, S3].map((text, i) => `  // Step ${i + 1}: ${text}`).join('\n');
