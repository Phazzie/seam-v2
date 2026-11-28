// `seam approve`: the owner approves a big step, in the Seam Approve window, never in the chat. `approve` is the window's
// side (a real keyboard, opened from the shortcut, the summary and the code shown, three tries at typing the code back) and
// `approveCore` is what decides: is it the code, is it still what was asked for, and then the phase move and its records.
import { join } from 'node:path';
import type { ApprovalRecord } from '../formats/state.ts';
import { removeFile } from '../lib/atomic.ts';
import { writeLock } from '../lib/fingerprint.ts';
import { logLine } from '../lib/log.ts';
import { updateState } from '../lib/store.ts';
import { snapshotProtected } from '../guard/tamper.ts';
import { buildCtx } from '../guard/context.ts';
import type { Ctx, Phase } from '../types.ts';
import { accept } from './accept.ts';
import { moveFor } from './moves.ts';
import type { Kind } from './moves.ts';
import { THE_WINDOW, refusedOutsideWindow } from './owner.ts';
import type { OwnerIo } from './owner.ts';
import { fingerprintsOf, loadPending, PENDING_PATH, sameFingerprints } from './pending.ts';
import type { Pending } from './pending.ts';

export const TRIES = 3;
const NOTHING_WAITING = 'there is nothing waiting for your approval';
const STALE = 'things changed since this was requested; ask for a fresh approval';

export type ApproveResult = { ok: true; kind: Kind; phase: Phase } | { ok: false; retry: boolean; reason: string };

const refused = (reason: string, retry = false): ApproveResult => ({ ok: false, retry, reason });

/** Why this request cannot be approved right now: the files are not as they were when it was asked for, or it does not fit the phase. Null if it can. */
function whyNot(ctx: Ctx, pending: Pending): string | null {
  if (!sameFingerprints(fingerprintsOf(ctx.root, ctx.plan), pending.fingerprints)) return STALE;
  const move = moveFor(pending.kind, ctx.state.phase);
  return move.ok ? null : move.why;
}

/** Make the approval happen: the lock (for a freeze), the record of it, the phase, and the guard's own record of the files this changed. */
function apply(ctx: Ctx, pending: Pending, next: Phase): ApproveResult {
  const { kind } = pending;
  if (kind === 'freeze') {
    if (ctx.plan === null) return refused('there is no plan to freeze');
    writeLock(ctx.root, ctx.plan); // first: if a planned file is not there it throws, and nothing has changed
  }
  const clears = kind === 'park' || kind === 'edit';
  updateState(ctx.root, ctx.dataDir, (s) => {
    const record: ApprovalRecord = { id: `${kind}-${s.approvals.length + 1}`, kind, at: ctx.now.toISOString(), fingerprints: pending.fingerprints, summary: pending.summary };
    return { ...s, phase: next, approvals: [...s.approvals, record], halted: clears ? null : s.halted };
  });
  removeFile(join(ctx.root, PENDING_PATH));
  logLine(ctx.root, `Owner approved ${kind}`);
  // The files this changed are protected: take them into the guard's record, or its next check would put them back.
  if (kind === 'freeze') snapshotProtected(buildCtx(ctx.root, ctx.dataDir, ctx.pluginRoot, ctx.now));
  else accept(ctx, PENDING_PATH);
  return { ok: true, kind, phase: next };
}

/** Check the code and what was asked for, then approve. A wrong code records nothing and may be tried again. */
export function approveCore(input: { typed: string }, ctx: Ctx): ApproveResult {
  const pending = loadPending(ctx.root);
  if (pending === null) return refused(NOTHING_WAITING);
  if (input.typed !== pending.code) return refused('that is not the code', true);
  const problem = whyNot(ctx, pending);
  if (problem !== null) return refused(problem);
  const move = moveFor(pending.kind, ctx.state.phase);
  return apply(ctx, pending, move.ok ? move.next : ctx.state.phase);
}

/**
 * The window: refuses unless there is a keyboard and it was opened from the shortcut, then shows what is asked for and
 * the code, and gives three tries at typing it back (a space around it and the letter case do not matter). `load` reads the
 * project, and is not called until the window has been checked. Returns the exit code.
 */
export async function approve(io: OwnerIo, load: () => Ctx): Promise<number> {
  if (refusedOutsideWindow(io, THE_WINDOW)) return 1;
  const ctx = load();
  const pending = loadPending(ctx.root);
  const problem = pending === null ? NOTHING_WAITING : whyNot(ctx, pending);
  if (pending === null || problem !== null) {
    io.say(`Nothing was approved: ${problem ?? NOTHING_WAITING}.`);
    return 1;
  }
  io.say(`${pending.summary}\n\nCode: ${pending.code}`);
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    const typed = (await io.ask(`Type the code above to approve (try ${attempt} of ${TRIES}): `)).trim().toUpperCase();
    const result = approveCore({ typed }, ctx);
    if (result.ok) {
      io.say(`Approved ${result.kind}. The project is now in the ${result.phase} phase.`);
      return 0;
    }
    if (!result.retry) {
      io.say(`Nothing was approved: ${result.reason}.`);
      return 1;
    }
    io.say('That is not the code.');
  }
  io.say('Three wrong tries, so nothing was approved. Open Seam Approve again to have another go.');
  return 1;
}
