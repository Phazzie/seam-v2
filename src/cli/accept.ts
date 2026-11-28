// Every seam script that changes a protected file ends by telling the tamper check that the change is legitimate (I-3),
// or the next check would put the file back and halt the run as if the main AI had changed it. One file: `acceptChange`.
// The script does it inside the same hold of the project lock as the change itself (R76): the tamper check settles under that
// lock, so it can never look at a file that is changed but not yet accepted. With no record at all there is nothing to keep in
// step, and a script the main AI can run (`seam request`) must not start one: a whole snapshot takes the project as it is, so it
// would bless whatever the guard was blocking on. Only the owner's own scripts (`seam edit`) may start a record, with `mayStart`.
import { acceptChangeLocked, snapshotProtectedLocked } from '../guard/tamper.ts';
import { loadRecord } from '../guard/tamperrecord.ts';
import type { Ctx } from '../types.ts';

/** Take the file at `rel` (a path from the repo root, as it is on disk now, or gone) into the guard's record. The caller holds the project lock. */
export function acceptLocked(ctx: Ctx, rel: string, mayStart = false): void {
  if (loadRecord(ctx) !== null) acceptChangeLocked(ctx, rel);
  else if (mayStart) snapshotProtectedLocked(ctx);
}
