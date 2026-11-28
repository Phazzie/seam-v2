// The Seam Approve window (R77): the owner's one place, opened from the desktop shortcut (seam-approve.cmd runs `seam window`).
// If a request is waiting and still good, it is approved there (approve.ts). Otherwise a short menu: the report, accepting the
// owner's own edits to protected files (or, with no record, taking a fresh one), repairing a record that cannot be read, or
// closing; and, if the waiting request cannot be read, clearing it. It needs the same real keyboard and shortcut as approve;
// the AI can run none of it.
import { join } from 'node:path';
import type { ApprovalRecord } from '../formats/state.ts';
import type { Home } from '../guard/tamperrecord.ts';
import { removeFile } from '../lib/atomic.ts';
import { logLine } from '../lib/log.ts';
import { updateStateLocked, withLock } from '../lib/store.ts';
import type { Ctx } from '../types.ts';
import { acceptLocked } from './accept.ts';
import { approveProblem, approveRequest, TRIES } from './approve.ts';
import { acceptEditsLocked, changesIn, editFingerprints, hasNoRecord, listChanges, NO_RECORD_YET } from './changes.ts';
import { SetupError } from './home.ts';
import { THE_WINDOW, refusedOutsideWindow } from './owner.ts';
import type { OwnerIo } from './owner.ts';
import { loadPending, newCode, PENDING_PATH, sameFingerprints } from './pending.ts';
import type { Pending } from './pending.ts';
import { renderReport } from './report.ts';
import { repair } from './repair.ts';

const menu = (badRequest: boolean): string =>
  ['', 'Seam Approve', '  1) Show the report', '  2) Accept my own edits to protected files', '  3) Repair a broken record', '  4) Close',
    ...(badRequest ? ['  5) Clear the request that cannot be read'] : [])].join('\n');

/** The project, null (with the reason said, and a way to put it right) if a record of it cannot be read, or 'setup' (said) if its setup is incomplete, which the window cannot mend. */
type Loaded = Ctx | null | 'setup';

function tryLoad(load: () => Ctx, io: OwnerIo): Loaded {
  try {
    return load();
  } catch (err) {
    if (err instanceof SetupError) {
      io.say(err.message);
      return 'setup';
    }
    if (!(err instanceof Error)) throw err;
    io.say(`${err.message} Choose 3 to put back the guard's saved copy.`); // a damaged record is what repair is for
    return null;
  }
}

/** A fresh code to type back, three tries. True if it was typed. */
async function typedTheCode(io: OwnerIo): Promise<boolean> {
  const code = newCode();
  io.say(`Code: ${code}`);
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    if ((await io.ask(`Type the code above to confirm (try ${attempt} of ${TRIES}): `)).trim().toUpperCase() === code) return true;
    io.say('That is not the code.');
  }
  io.say('Three wrong tries, so nothing was accepted.');
  return false;
}

/** What the owner is told before the code is asked for: what differs, or that there is no record and a fresh one will be taken. */
function sayWhat(io: OwnerIo, ctx: Ctx, changes: ReturnType<typeof changesIn>): void {
  const stopped = ctx.state.halted;
  if (hasNoRecord(ctx)) {
    io.say(`${NO_RECORD_YET}${changes.length === 0 ? '.' : `, and updates the lock for these locked files that differ from it:\n${listChanges(changes)}`}`);
    if (stopped !== null) io.say(`The run is stopped (${stopped}); this lets it carry on.`);
  } else if (changes.length === 0) {
    io.say(`No protected file differs from what the guard has. The run is stopped (${stopped ?? ''}); accepting lets it carry on.`);
  } else {
    io.say(`These protected files differ from what the guard has:\n${listChanges(changes)}`);
    io.say(`Accepting takes them exactly as they are now as the approved versions, and updates the lock for them${stopped === null ? '.' : `, and lets the stopped run carry on (${stopped}).`}`);
  }
}

/** Choice 2: show what differs (or that there is no record), and, on a fresh code, take it in and let a stopped run carry on. */
async function acceptOwnEdits(io: OwnerIo, ctx: Ctx): Promise<void> {
  const changes = changesIn(ctx);
  if (changes.length === 0 && ctx.state.halted === null && !hasNoRecord(ctx)) {
    io.say('No protected file differs from what the guard has, and the run is not stopped, so there is nothing to accept.');
    return;
  }
  sayWhat(io, ctx, changes);
  const shown = editFingerprints(ctx, changes);
  if (!(await typedTheCode(io))) return;
  const done = withLock(ctx.root, () => {
    const now = changesIn(ctx);
    if (!sameFingerprints(editFingerprints(ctx, now), shown)) return null; // changed again while the owner decided
    const fresh = hasNoRecord(ctx);
    const keys = acceptEditsLocked(ctx, now);
    let what = 'let the stopped run carry on';
    if (fresh) what = 'took a fresh record of the protected files';
    else if (keys.length > 0) what = `accepted their own edits to: ${keys.join(', ')}`;
    updateStateLocked(ctx.root, ctx.dataDir, (s) => {
      const record: ApprovalRecord = { id: `edit-${s.approvals.length + 1}`, kind: 'edit', at: ctx.now.toISOString(), fingerprints: shown, summary: `The owner ${what}.` };
      return { ...s, approvals: [...s.approvals, record], halted: null };
    });
    logLine(ctx.root, `Owner ${what}`);
    return { keys, fresh };
  });
  if (done === null) io.say('Things changed while you were deciding, so nothing was accepted. Choose 2 again to see them as they are now.');
  else if (done.fresh) io.say('Done: a fresh record was taken.');
  else io.say(`Done: ${done.keys.length === 0 ? 'the run can carry on' : `${done.keys.length} file${done.keys.length === 1 ? '' : 's'} accepted`}.`);
}

/** The waiting request, or why it cannot be read. */
function readRequest(ctx: Ctx): { pending: Pending | null; unreadable: string | null } {
  try {
    return { pending: loadPending(ctx.root), unreadable: null };
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    return { pending: null, unreadable: err.message };
  }
}

/** Choice 5: take away a request file that cannot be read, so a new one can be asked for. */
function clearUnreadableRequest(io: OwnerIo, ctx: Ctx): void {
  withLock(ctx.root, () => {
    removeFile(join(ctx.root, PENDING_PATH));
    acceptLocked(ctx, PENDING_PATH);
    logLine(ctx.root, 'Owner cleared a request that could not be read');
  });
  io.say('Cleared the request that could not be read. Ask Claude to request it again.');
}

/**
 * Run the window. It refuses unless there is a keyboard and it was opened from the shortcut. A waiting request that can be approved
 * goes straight to approving; otherwise the menu. `load` reads the project and `home` says where it is (so a record that cannot be
 * read can still be repaired); neither is called until the window has been checked. A project whose setup is incomplete is said so
 * (run seam init again) and the window closes: nothing here can mend that. Returns the exit code.
 */
export async function windowCommand(io: OwnerIo, load: () => Ctx, home: () => Home): Promise<number> {
  if (refusedOutsideWindow(io, THE_WINDOW)) return 1;
  let ctx = tryLoad(load, io);
  if (ctx === 'setup') return 1;
  let unreadable: string | null = null;
  if (ctx !== null) {
    const request = readRequest(ctx);
    unreadable = request.unreadable;
    if (request.pending !== null) {
      const problem = approveProblem(ctx, request.pending);
      if (problem === null) return approveRequest(io, ctx);
      io.say(`The request waiting for you (${request.pending.kind}) cannot be approved: ${problem}. Ask Claude to request it again.`);
    }
    if (unreadable !== null) io.say(`The request waiting for you cannot be read (${unreadable}). It can be cleared from the menu, and Claude can ask again.`);
  }
  for (;;) {
    io.say(menu(unreadable !== null));
    const choice = (await io.ask('Type a number: ')).trim();
    if (choice === '4') return 0;
    if (choice === '3') {
      await repair(io, home());
      ctx = tryLoad(load, io);
    } else if (ctx === null) {
      io.say('Choose 3 first: nothing else works while a record cannot be read.');
    } else if (ctx === 'setup') {
      return 1;
    } else if (choice === '1') {
      io.say(renderReport(ctx, new Date()));
    } else if (choice === '2') {
      try {
        await acceptOwnEdits(io, ctx);
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        io.say(`${err.message} Nothing was accepted.`); // a locked code file that no longer parses, say: the owner fixes it and chooses 2 again
      }
      ctx = tryLoad(load, io);
    } else if (choice === '5' && unreadable !== null) {
      clearUnreadableRequest(io, ctx);
      unreadable = null;
    } else {
      io.say('Type 1, 2, 3 or 4.');
    }
  }
}
