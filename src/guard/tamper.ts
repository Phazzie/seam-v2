// Stubs, replaced in Task 12 by the real tamper check. `snapshotProtected` exists now so the cheat-test
// helper can import it; every cheat that needs a snapshot fails with "not implemented" until then.
// `checkTamper` finds nothing, so the hook has something to call after a tool has run.
import type { Ctx, HookInput } from '../types.ts';

/** Record every protected file so a later change can be detected and put back. */
export function snapshotProtected(ctx: Ctx): void {
  throw new Error('not implemented');
}

/** After a tool ran: what changed that should not have, in plain words. None until Task 12. */
export function checkTamper(input: HookInput, ctx: Ctx): { problems: string[] } {
  return { problems: [] };
}
