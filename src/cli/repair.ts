// `seam repair`: put back a plan.json, lock.json, env.json or state.json that cannot be read, from the guard's own saved copy of it
// (the kept content of the file in the data folder, or the copy of state.json). The hook does this itself after a tool
// ran; this is for when it could not (the owner broke a file by hand, or the hooks were not running). It needs a real
// keyboard, the Seam Approve window or the owner's own terminal, and it is not on the list of commands the AI may run:
// it blesses whatever the saved copy holds, and nothing the AI can reach should be able to do that. It puts back only what
// cannot be read and takes only those files into the record, so nothing else that changed is accepted along the way.
// The saved copies are the guard's record of the protected files, and that can itself be damaged: it cannot be put back from itself,
// so it is set aside (to quarantine, not deleted), and the window's "accept my own edits" takes a fresh one.
import { join } from 'node:path';
import { ENV_PATH, loadEnv } from '../formats/env.ts';
import { loadLock, LOCK_PATH } from '../formats/lock.ts';
import { loadPlan, PLAN_PATH } from '../formats/plan.ts';
import { STATE_PATH } from '../formats/state.ts';
import { moveAside } from '../guard/tamperfix.ts';
import { loadRecord, recordFolder } from '../guard/tamperrecord.ts';
import type { Home } from '../guard/tamperrecord.ts';
import { restoreBrokenLocked } from '../guard/tamperrepair.ts';
import { logLine } from '../lib/log.ts';
import { readState, withLock } from '../lib/store.ts';
import { refusedWithoutKeyboard } from './owner.ts';
import type { OwnerIo } from './owner.ts';

const REFUSAL = 'repairs happen in your own terminal or the Seam Approve window, not through Claude';

/** Which of the files cannot be read as they are (a plan or lock that is not there is fine; state.json has to be there). */
function unreadable(root: string): string[] {
  const reads: [string, () => unknown][] = [[PLAN_PATH, () => loadPlan(root)], [LOCK_PATH, () => loadLock(root)], [ENV_PATH, () => loadEnv(root)], [STATE_PATH, () => readState(root)]];
  return reads.flatMap(([path, read]) => {
    try {
      read();
      return [];
    } catch (err) {
      if (err instanceof Error) return [path]; // what it says about the text is not shown: the file may hold anything
      throw err;
    }
  });
}

/** Is the guard's record of the protected files there but damaged? (No record at all is not damage: it is what the window's "accept my own edits" takes.) */
function recordDamaged(home: Home): boolean {
  try {
    loadRecord(home);
    return false;
  } catch (err) {
    if (err instanceof Error) return true;
    throw err;
  }
}

/** What one look and put-back found: nothing wrong, what was put back, where a damaged record went, and what still cannot be read. */
interface Repaired { fine: boolean; restored: string[]; setAside: string | null; couldNotSetAside: string | null; still: string[] }

/** Run `seam repair`: returns the exit code. Looking, putting back and logging happen in one hold of the project lock (R76). */
export async function repair(io: OwnerIo, home: Home): Promise<number> {
  if (refusedWithoutKeyboard(io, REFUSAL)) return 1;
  const { fine, restored, setAside, couldNotSetAside, still }: Repaired = withLock(home.root, () => {
    const damaged = recordDamaged(home);
    if (!damaged && unreadable(home.root).length === 0) return { fine: true, restored: [], setAside: null, couldNotSetAside: null, still: [] };
    let aside: string | null = null;
    let failed: string | null = null;
    if (damaged) {
      const moved = moveAside({ dataDir: home.dataDir, now: new Date() }, 'protected.json', join(recordFolder(home), 'protected.json'));
      if (typeof moved === 'string') failed = moved;
      else aside = moved.to;
      if (aside !== null) logLine(home.root, `Owner ran repair: set the damaged record of the protected files aside to ${aside}`);
    }
    const put = restoreBrokenLocked(home);
    if (put.length > 0) logLine(home.root, `Owner ran repair: put back ${put.join(', ')}`);
    return { fine: false, restored: put, setAside: aside, couldNotSetAside: failed, still: unreadable(home.root) };
  });
  if (fine) {
    io.say('Nothing needed repair: plan.json, lock.json, env.json and state.json all read fine, and so does the guard\'s record of the protected files.');
    return 0;
  }
  if (restored.length > 0) io.say(`Put back ${restored.join(', ')} from the guard's saved copy.`);
  if (setAside !== null) io.say(`The guard's record of the protected files was damaged, and has been set aside (${setAside}). Open the Seam Approve window and choose "Accept my own edits" to take a fresh one.`);
  if (couldNotSetAside !== null) io.say(`The guard's record of the protected files is damaged, and could not be set aside (${couldNotSetAside}).`);
  for (const path of still) {
    io.say(`${path} is still unreadable, and the guard has no saved copy of it to put back. Fix it by hand (or get it back from git), then run seam edit on it.`);
  }
  return still.length === 0 && couldNotSetAside === null ? 0 : 1;
}
