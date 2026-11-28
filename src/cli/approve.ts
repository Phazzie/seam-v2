// `seam approve`: the owner approves a big step, in the Seam Approve window, never in the chat. `approveRequest` is the window's
// side (the summary and the code shown, three tries at typing the code back; `approve` adds the checks that it is a real keyboard
// and the shortcut's window) and `approveCore` is what decides: is it the code, is it still what was asked for, and then the
// phase move and its records.
import { join } from 'node:path';
import type { ApprovalRecord } from '../formats/state.ts';
import { removeFile } from '../lib/atomic.ts';
import { writeLock } from '../lib/fingerprint.ts';
import { logLine } from '../lib/log.ts';
import { readState, updateStateLocked, withLock } from '../lib/store.ts';
import { snapshotProtectedLocked } from '../guard/tamper.ts';
import { buildCtx } from '../guard/context.ts';
import type { Ctx, Phase } from '../types.ts';
import { acceptLocked } from './accept.ts';
import { acceptEditsLocked, changesIn, editFingerprints, listChanges } from './changes.ts';
import { moveFor } from './moves.ts';
import type { Kind } from './moves.ts';
import { THE_WINDOW, refusedOutsideWindow } from './owner.ts';
import type { OwnerIo } from './owner.ts';
import { fingerprintsFor, loadPending, PENDING_PATH, sameFingerprints } from './pending.ts';
import type { Pending } from './pending.ts';

export const TRIES = 3;
export const NOTHING_WAITING = 'there is nothing waiting for your approval';
const STALE = 'things changed since this was requested; ask for a fresh approval';
const CHANGED_WHILE_DECIDING = 'the files changed while you were deciding; open the window again to see them as they are now';

export type ApproveResult = { ok: true; kind: Kind; phase: Phase } | { ok: false; retry: boolean; reason: string };

const refused = (reason: string, retry = false): ApproveResult => ({ ok: false, retry, reason });

/** Why this request cannot be approved right now: the files are not as they were when it was asked for, or it does not fit the phase. Null if it can. */
export function approveProblem(ctx: Ctx, pending: Pending, phase: Phase = ctx.state.phase): string | null {
  if (!sameFingerprints(fingerprintsFor(ctx, pending.kind), pending.fingerprints)) return STALE;
  const move = moveFor(pending.kind, phase);
  return move.ok ? null : move.why;
}

/**
 * Make the approval happen: the lock (for a freeze), the owner's own edits (for an edit), the record of it, the phase, and the
 * guard's own record of the files this changed. The caller holds the project lock for all of it, and the tamper check settles
 * under that lock, so it cannot look at the new lock.json between its being written and its being recorded (R76).
 */
function apply(ctx: Ctx, pending: Pending, next: Phase, shown?: Record<string, string>): ApproveResult {
  const { kind } = pending;
  if (kind === 'freeze') {
    if (ctx.plan === null) return refused('there is no plan to freeze');
    writeLock(ctx.root, ctx.plan); // first: if a planned file is not there it throws, and nothing has changed
  }
  // An edit takes the owner's own changes to the protected files into the guard's record (and the lock), or its next check would
  // put them back and halt the run again, blaming the main AI (R77).
  let accepted: string[] = [];
  if (kind === 'edit') {
    const changes = changesIn(ctx);
    if (shown !== undefined && !sameFingerprints(editFingerprints(ctx, changes), shown)) return refused(CHANGED_WHILE_DECIDING);
    accepted = acceptEditsLocked(ctx, changes);
  }
  const clears = kind === 'park' || kind === 'edit';
  updateStateLocked(ctx.root, ctx.dataDir, (s) => {
    const record: ApprovalRecord = { id: `${kind}-${s.approvals.length + 1}`, kind, at: ctx.now.toISOString(), fingerprints: pending.fingerprints, summary: pending.summary };
    return { ...s, phase: next, approvals: [...s.approvals, record], halted: clears ? null : s.halted };
  });
  removeFile(join(ctx.root, PENDING_PATH));
  logLine(ctx.root, `Owner approved ${kind}`);
  if (accepted.length > 0) logLine(ctx.root, `Owner accepted their own edits to: ${accepted.join(', ')}`);
  // The files this changed are protected: take them into the guard's record, or its next check would put them back.
  if (kind === 'freeze') snapshotProtectedLocked(buildCtx(ctx.root, ctx.dataDir, ctx.pluginRoot, ctx.now));
  else acceptLocked(ctx, PENDING_PATH);
  return { ok: true, kind, phase: next };
}

/**
 * Check the code and what was asked for, then approve, all in one hold of the project lock. A wrong code records nothing and may be
 * tried again. For an edit, `shown` is what the owner was shown differing (editFingerprints): if the files differ from it by now,
 * nothing is accepted.
 */
export function approveCore(input: { typed: string; shown?: Record<string, string> }, ctx: Ctx): ApproveResult {
  return withLock(ctx.root, () => {
    const pending = loadPending(ctx.root);
    if (pending === null) return refused(NOTHING_WAITING);
    if (input.typed !== pending.code) return refused('that is not the code', true);
    const { phase } = readState(ctx.root); // as it is now, not as it was when the command started
    const problem = approveProblem(ctx, pending, phase);
    if (problem !== null) return refused(problem);
    const move = moveFor(pending.kind, phase);
    return apply(ctx, pending, move.ok ? move.next : phase, input.shown);
  });
}

/**
 * Show what is asked for and the code, and give three tries at typing it back (a space around it and the letter case do not
 * matter). The window has been checked already. Returns the exit code.
 */
export async function approveRequest(io: OwnerIo, ctx: Ctx): Promise<number> {
  const pending = loadPending(ctx.root);
  const problem = pending === null ? NOTHING_WAITING : approveProblem(ctx, pending);
  if (pending === null || problem !== null) {
    io.say(`Nothing was approved: ${problem ?? NOTHING_WAITING}.`);
    return 1;
  }
  // An edit accepts whatever differs when it is approved, so the owner is shown that now, and what is shown is what is accepted.
  const changes = pending.kind === 'edit' ? changesIn(ctx) : [];
  const shown = pending.kind === 'edit' ? editFingerprints(ctx, changes) : undefined;
  let listing = '';
  if (pending.kind === 'edit') {
    listing = changes.length === 0
      ? '\n\nNo protected file differs from what the guard has, so approving only lets the run carry on.'
      : `\n\nThese protected files differ from what the guard has. Approving takes them exactly as they are now, and updates the lock for them:\n${listChanges(changes)}`;
  }
  io.say(`${pending.summary}${listing}\n\nCode: ${pending.code}`);
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    const typed = (await io.ask(`Type the code above to approve (try ${attempt} of ${TRIES}): `)).trim().toUpperCase();
    const result = approveCore({ typed, shown }, ctx);
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

/** `seam approve`: refuses unless there is a keyboard and it was opened from the shortcut. `load` reads the project, and is not called until the window has been checked. */
export async function approve(io: OwnerIo, load: () => Ctx): Promise<number> {
  if (refusedOutsideWindow(io, THE_WINDOW)) return 1;
  return approveRequest(io, load());
}
