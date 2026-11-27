// Stub, replaced in Task 12 by the real tamper check. It exists now so the cheat-test helper
// can import it; every cheat that needs a snapshot fails with "not implemented" until then.
import type { Ctx } from '../types.ts';

/** Record every protected file so a later change can be detected and put back. */
export function snapshotProtected(ctx: Ctx): void {
  throw new Error('not implemented');
}
