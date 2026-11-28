// `seam request <kind>`: ask the owner to approve something. It writes `.seam/pending.json`; it approves nothing. The
// main AI may run it, because only `seam approve` (in the owner's window) acts on what it writes. The code is not printed:
// the AI sees what a command prints, and the owner reads the code in the window.
import { join } from 'node:path';
import { atomicWrite } from '../lib/atomic.ts';
import { logLine } from '../lib/log.ts';
import { withLock } from '../lib/store.ts';
import type { Ctx } from '../types.ts';
import { acceptLocked } from './accept.ts';
import { isKind, KINDS, moveFor } from './moves.ts';
import { fingerprintsOf, missingPlanned, newCode, PENDING_PATH } from './pending.ts';
import type { Pending } from './pending.ts';
import { summaryOf } from './summary.ts';

/** Write the request, replacing any that is waiting. Returns what to tell whoever asked. Throws, in plain words, if it cannot be asked for now. */
export function requestApproval(ctx: Ctx, kind: string): string {
  if (!isKind(kind)) throw new Error(`"${kind}" is not something the owner can be asked to approve; the kinds are ${KINDS.join(', ')}.`);
  const move = moveFor(kind, ctx.state.phase);
  if (!move.ok) throw new Error(`${move.why}.`);
  if (kind === 'freeze') {
    if (ctx.plan === null) throw new Error('There is no plan (plan/plan.json), so there is nothing to freeze yet.');
    const missing = missingPlanned(ctx.root, ctx.plan);
    if (missing.length > 0) throw new Error(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} in the plan but not on disk, so the plan cannot be frozen yet.`);
  }
  // One hold of the lock for all of it (R76): until the request is in the guard's record, a hook's check would move it aside as a stranger.
  withLock(ctx.root, () => {
    const fingerprints = fingerprintsOf(ctx.root, ctx.plan);
    const pending: Pending = { kind, code: newCode(), summary: summaryOf(ctx, kind, fingerprints), fingerprints };
    atomicWrite(join(ctx.root, PENDING_PATH), `${JSON.stringify(pending, null, 2)}\n`);
    acceptLocked(ctx, PENDING_PATH);
    logLine(ctx.root, `Asked the owner to approve ${kind}`);
  });
  return `Asked the owner to approve ${kind}. Nothing is approved until they open Seam Approve on their desktop and type the code it shows.`;
}
