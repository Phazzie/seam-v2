// The Seam Approve window (R77): the owner's one place, opened from the desktop shortcut (seam-approve.cmd runs `seam window`).
// If a request is waiting and still good, it is approved there (approve.ts). Otherwise a short menu: the report, accepting the
// owner's own edits to protected files, repairing a record that cannot be read, or closing. It needs the same real keyboard and
// shortcut as approve; the AI can run none of it.
import { updateStateLocked, withLock } from '../lib/store.ts';
import { logLine } from '../lib/log.ts';
import type { ApprovalRecord } from '../formats/state.ts';
import type { Home } from '../guard/tamperrecord.ts';
import type { Ctx } from '../types.ts';
import { approveProblem, approveRequest, TRIES } from './approve.ts';
import { acceptEditsLocked, changesIn, editFingerprints, listChanges } from './changes.ts';
import { THE_WINDOW, refusedOutsideWindow } from './owner.ts';
import type { OwnerIo } from './owner.ts';
import { loadPending, newCode, sameFingerprints } from './pending.ts';
import { renderReport } from './report.ts';
import { repair } from './repair.ts';

const MENU = ['', 'Seam Approve', '  1) Show the report', '  2) Accept my own edits to protected files', '  3) Repair a broken record', '  4) Close'].join('\n');

/** The project, or null (with the reason said) if its plan, lock or state cannot be read: the repair choice still works then. */
function tryLoad(load: () => Ctx, io: OwnerIo): Ctx | null {
  try {
    return load();
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    io.say(`${err.message} Choose 3 to put back the guard's saved copy.`);
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

/** Choice 2: show the protected files that differ from the guard's record, and, on a fresh code, take them in and let a stopped run carry on. */
async function acceptOwnEdits(io: OwnerIo, ctx: Ctx): Promise<void> {
  const changes = changesIn(ctx);
  const stopped = ctx.state.halted;
  if (changes.length === 0 && stopped === null) {
    io.say('No protected file differs from what the guard has, and the run is not stopped, so there is nothing to accept.');
    return;
  }
  if (changes.length === 0) io.say(`No protected file differs from what the guard has. The run is stopped (${stopped}); accepting lets it carry on.`);
  else {
    io.say(`These protected files differ from what the guard has:\n${listChanges(changes)}`);
    io.say(`Accepting takes them exactly as they are now as the approved versions, and updates the lock for them${stopped === null ? '.' : `, and lets the stopped run carry on (${stopped}).`}`);
  }
  const shown = editFingerprints(ctx, changes);
  if (!(await typedTheCode(io))) return;
  const accepted = withLock(ctx.root, () => {
    const now = changesIn(ctx);
    if (!sameFingerprints(editFingerprints(ctx, now), shown)) return null; // changed again while the owner decided
    const keys = acceptEditsLocked(ctx, now);
    const summary = keys.length === 0 ? 'The owner let the stopped run carry on.' : `The owner accepted their own edits to: ${keys.join(', ')}.`;
    updateStateLocked(ctx.root, ctx.dataDir, (s) => {
      const record: ApprovalRecord = { id: `edit-${s.approvals.length + 1}`, kind: 'edit', at: ctx.now.toISOString(), fingerprints: shown, summary };
      return { ...s, approvals: [...s.approvals, record], halted: null };
    });
    logLine(ctx.root, keys.length === 0 ? 'Owner let the stopped run carry on' : `Owner accepted their own edits to: ${keys.join(', ')}`);
    return keys;
  });
  io.say(accepted === null ? 'Things changed while you were deciding, so nothing was accepted. Choose 2 again to see them as they are now.' : `Done: ${accepted.length === 0 ? 'the run can carry on' : `${accepted.length} file${accepted.length === 1 ? '' : 's'} accepted`}.`);
}

/**
 * Run the window. It refuses unless there is a keyboard and it was opened from the shortcut. A waiting request that can be approved
 * goes straight to approving; otherwise the menu. `load` reads the project and `home` says where it is (so a record that cannot be
 * read can still be repaired); neither is called until the window has been checked. Returns the exit code.
 */
export async function windowCommand(io: OwnerIo, load: () => Ctx, home: () => Home): Promise<number> {
  if (refusedOutsideWindow(io, THE_WINDOW)) return 1;
  let ctx = tryLoad(load, io);
  const pending = ctx === null ? null : loadPending(ctx.root);
  if (ctx !== null && pending !== null) {
    const problem = approveProblem(ctx, pending);
    if (problem === null) return approveRequest(io, ctx);
    io.say(`The request waiting for you (${pending.kind}) cannot be approved: ${problem}. Ask Claude to request it again.`);
  }
  for (;;) {
    io.say(MENU);
    const choice = (await io.ask('Type a number: ')).trim();
    if (choice === '4') return 0;
    if (choice === '3') {
      await repair(io, home());
      ctx = tryLoad(load, io);
    } else if (ctx === null) {
      io.say('Choose 3 first: nothing else works while a record cannot be read.');
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
    } else {
      io.say('Type 1, 2, 3 or 4.');
    }
  }
}
