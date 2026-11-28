// `seam repair`: put back a plan.json, lock.json or state.json that cannot be read, from the guard's own saved copy of it
// (the kept content of the file in the data folder, or the copy of state.json). The hook does this itself after a tool
// ran; this is for when it could not (the owner broke a file by hand, or the hooks were not running). It needs a real
// keyboard, the Seam Approve window or the owner's own terminal, and it is not on the list of commands the AI may run:
// it blesses whatever the saved copy holds, and nothing the AI can reach should be able to do that. It puts back only what
// cannot be read and takes only those files into the record, so nothing else that changed is accepted along the way.
import { loadLock, LOCK_PATH } from '../formats/lock.ts';
import { loadPlan, PLAN_PATH } from '../formats/plan.ts';
import { STATE_PATH } from '../formats/state.ts';
import { restoreBroken } from '../guard/tamperrepair.ts';
import type { Home } from '../guard/tamperrecord.ts';
import { logLine } from '../lib/log.ts';
import { readState } from '../lib/store.ts';
import { refusedWithoutKeyboard } from './owner.ts';
import type { OwnerIo } from './owner.ts';

const REFUSAL = 'repairs happen in your own terminal or the Seam Approve window, not through Claude';

/** Which of the three files cannot be read as they are (a plan or lock that is not there is fine; state.json has to be there). */
function unreadable(root: string): string[] {
  const reads: [string, () => unknown][] = [[PLAN_PATH, () => loadPlan(root)], [LOCK_PATH, () => loadLock(root)], [STATE_PATH, () => readState(root)]];
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

/** Run `seam repair`: returns the exit code. */
export async function repair(io: OwnerIo, home: Home): Promise<number> {
  if (refusedWithoutKeyboard(io, REFUSAL)) return 1;
  if (unreadable(home.root).length === 0) {
    io.say('Nothing needed repair: plan.json, lock.json and state.json all read fine.');
    return 0;
  }
  const restored = restoreBroken(home);
  if (restored.length > 0) {
    logLine(home.root, `Owner ran repair: put back ${restored.join(', ')}`);
    io.say(`Put back ${restored.join(', ')} from the guard's saved copy.`);
  }
  const still = unreadable(home.root);
  for (const path of still) {
    io.say(`${path} is still unreadable, and the guard has no saved copy of it to put back. Fix it by hand (or get it back from git), then run seam edit on it.`);
  }
  return still.length === 0 ? 0 : 1;
}
