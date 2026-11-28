// A record file the guard reads before every decision (plan/plan.json, .seam/lock.json, .seam/state.json) that was
// overwritten with text the guard cannot read makes the context fail to build, so the tamper check never runs and
// every call is refused with an internal error, for good. After a tool ran, `restoreBroken` puts such a file back
// first (the plan and the lock from the guard's record and its kept copy, state.json from its copy), so the context
// builds and the tamper check goes on as for any other change: reported, and charged to whoever made the tool call.
// What was in the broken file is never logged, only its name.
import { loadLock, LOCK_PATH } from '../formats/lock.ts';
import { loadPlan, PLAN_PATH } from '../formats/plan.ts';
import { STATE_PATH } from '../formats/state.ts';
import { logLine } from '../lib/log.ts';
import { readState, withLock } from '../lib/store.ts';
import { putBack } from './tamperfix.ts';
import { absOf, fold, loadRecord, saveRecord } from './tamperrecord.ts';
import type { Home, TamperRecord } from './tamperrecord.ts';
import { restoreState } from './tamperstate.ts';

/** Can this record file not be read as it is? (A plan or a lock that is not there is fine; state.json has to be there.) */
function broken(read: () => unknown): boolean {
  try {
    read();
    return false;
  } catch (err) {
    if (err instanceof Error) return true; // what it says about the text is not logged
    throw err;
  }
}

/** Put a recorded file back from its kept copy, if the record holds it. */
function putRecorded(home: Home, rec: TamperRecord, path: string): boolean {
  const key = Object.keys(rec.files).find((name) => fold(name) === fold(path));
  if (key === undefined) return false;
  const back = putBack(home, absOf(home, key), rec.files[key]);
  if (typeof back === 'string') return false;
  rec.files[key] = back;
  return true;
}

/**
 * Put back whichever of plan.json, lock.json and state.json cannot be read. Returns their paths (none if all three
 * read fine, or the guard has nothing to put back from). Under the lock.
 */
export function restoreBroken(home: Home): string[] {
  return withLock(home.root, () => {
    const rec = loadRecord(home);
    const restored: string[] = [];
    if (rec !== null) {
      if (broken(() => loadPlan(home.root)) && putRecorded(home, rec, PLAN_PATH)) restored.push(PLAN_PATH);
      if (broken(() => loadLock(home.root)) && putRecorded(home, rec, LOCK_PATH)) restored.push(LOCK_PATH);
      if (restored.length > 0) saveRecord(home, rec);
    }
    if (broken(() => readState(home.root)) && restoreState(home)) restored.push(STATE_PATH);
    for (const path of restored) logLine(home.root, `Put back ${path}: it had been overwritten with text the guard cannot read.`);
    return restored;
  });
}
