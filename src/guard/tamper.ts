// The tamper check (6.3): after every tool, the protected files are compared with the guard's record, and what
// changed outside the rules is put back (a new file that has no place is moved aside) and logged. It catches
// what a command or an unknown tool did, which could not be read in advance. After a file tool it takes the quick
// pass (size and modified time); after a command or any tool the guard does not know, the full one (15.17).
//
// `snapshotProtected` and `acceptChange` are for the seam scripts and the guard: a snapshot takes the project as it
// is, and accepting one file takes a legitimate change (the builder's own file after an allowed write, a script's
// output). The record, the walk, the scans and the settling live in the tamper*.ts files next to this one.
import { isAbsolute, relative } from 'node:path';
import { STATE_PATH } from '../formats/state.ts';
import { logLine } from '../lib/log.ts';
import { withLock } from '../lib/store.ts';
import type { Ctx, HookInput } from '../types.ts';
import { finished, inFlight } from './inflight.ts';
import { isTurnBuilder, turnKey, verifierFor } from './tamperbuilder.ts';
import type { Verifier } from './tamperbuilder.ts';
import { judge, PUT_BACK } from './tamperjudge.ts';
import type { Case } from './tamperjudge.ts';
import { emptyRecord, fold, loadRecord, measure, saveRecord } from './tamperrecord.ts';
import type { TamperRecord } from './tamperrecord.ts';
import { fullScan, newByWrite, quickScan } from './tamperscan.ts';
import type { Finding } from './tamperscan.ts';
import { copyState, restoreState, stateDiffers } from './tamperstate.ts';
import { frozenCode, takeIn } from './tampertake.ts';
import { walkRepo } from './tamperwalk.ts';
import { consequences } from './tamperwho.ts';

/** The tools after which the quick pass is enough: they change one file, and the guard decided on it before they ran. */
const FILE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const NO_RECORD = "the guard's record of the protected files is missing, so this was blocked to be safe";

/** Record every protected file (its content too), and the code files that are there, as they are now. Replaces any earlier record. */
export function snapshotProtected(ctx: Ctx): void {
  withLock(ctx.root, () => {
    const frozen = frozenCode(ctx);
    const rec = emptyRecord();
    walkRepo(ctx, ({ key, abs, cls }) => {
      if (cls === null) rec.code.push(key);
      if (cls !== null || frozen(key)) rec.files[key] = measure(ctx, abs);
    });
    saveRecord(ctx, rec);
    copyState(ctx);
  });
}

/** Take one file (a path from the repo root, or an absolute one) into the record as it is now: it was changed, added or removed legitimately. */
export function acceptChange(ctx: Ctx, relPath: string): void {
  const given = isAbsolute(relPath) ? relative(ctx.root, relPath) : relPath;
  const asked = given.replace(/\\/g, '/').replace(/^\.\//, '');
  withLock(ctx.root, () => {
    const rec = loadRecord(ctx);
    if (rec === null) throw new Error(`There is no record of the protected files yet, so ${asked} cannot be accepted into it. Take a snapshot first.`);
    takeIn(ctx, rec, [...Object.keys(rec.files), ...rec.code].find((key) => fold(key) === fold(asked)) ?? asked);
    saveRecord(ctx, rec);
  });
}

/** What the call that is being checked was allowed to do, and what else was running. */
interface Call { allowed: ReadonlySet<string>; verify: Verifier | null; others: number }

/** Settle what the scan found, under the lock and against the record as it is by then. Returns the problems, in plain words. */
function settle(ctx: Ctx, input: HookInput, call: Call, found: Finding[], restored: readonly string[]): string[] {
  const rec = loadRecord(ctx);
  if (rec === null) return [];
  const before = JSON.stringify(rec);
  const problems: string[] = [];
  const hurt: string[] = [];
  if (stateDiffers(ctx)) {
    restoreState(ctx);
    logLine(ctx.root, `Put back ${STATE_PATH}, which was changed behind the guard.`);
    problems.push(`${STATE_PATH} was changed ${PUT_BACK}`);
    hurt.push(STATE_PATH);
  }
  for (const path of restored) {
    problems.push(`${path} was changed ${PUT_BACK}`);
    if (!call.allowed.has(fold(path))) hurt.push(path); // not charged to a call that was let through to write it
  }
  const c: Case = { ctx, rec, allowed: call.allowed, builder: isTurnBuilder(ctx, input), turn: turnKey(ctx), verify: call.verify };
  let halt: string | undefined;
  for (const f of found) {
    const verdict = judge(c, f);
    if (verdict !== null) {
      problems.push(verdict.problem);
      hurt.push(verdict.key);
      halt ??= verdict.halt;
    }
  }
  consequences(ctx, input, rec, hurt, call.others, halt);
  if (JSON.stringify(rec) !== before) saveRecord(ctx, rec);
  return problems;
}

/** The count of changes in a row that nobody could be blamed for starts again at the first check that finds nothing (15.16). */
function forgetUnattributed(ctx: Ctx, rec: TamperRecord): void {
  if (rec.unattributed === 0) return;
  withLock(ctx.root, () => {
    const now = loadRecord(ctx);
    if (now !== null && now.unattributed > 0) saveRecord(ctx, { ...now, unattributed: 0 });
  });
}

/**
 * After a tool ran: what changed that should not have, in plain words (none if nothing did). It is async because
 * the check of the turn builder's own file loads the TypeScript parser, and only then. `restored` are record files
 * the hook already had to put back to build its context (see tamperrepair.ts): they count as changes, here.
 * A file that another call under way was let through for is left alone: its own after-hook accepts it.
 */
export async function checkTamper(input: HookInput, ctx: Ctx, restored: readonly string[] = []): Promise<{ problems: string[] }> {
  try {
    return await check(input, ctx, restored);
  } finally {
    finished(ctx, input); // only now: until the check has settled, another call's check must still see this one under way
  }
}

async function check(input: HookInput, ctx: Ctx, restored: readonly string[]): Promise<{ problems: string[] }> {
  const call = inFlight(ctx, input);
  const rec = loadRecord(ctx);
  if (rec === null) return { problems: ctx.lock === null ? [] : [NO_RECORD] };
  const allowed = new Set(call.paths.map(fold));
  const theirs = new Set(call.otherPaths.map(fold));
  const scanned = FILE_TOOLS.has(input.tool_name ?? '') ? quickScan(ctx, rec) : fullScan(ctx, rec);
  const found = [...scanned, ...newByWrite(ctx, rec, [...allowed]).filter((f) => !scanned.some((g) => g.key === f.key))]
    .filter((f) => allowed.has(fold(f.key)) || !theirs.has(fold(f.key)));
  if (found.length === 0 && restored.length === 0 && !stateDiffers(ctx)) {
    forgetUnattributed(ctx, rec);
    return { problems: [] };
  }
  const verify = await verifierFor(ctx, input, found, allowed);
  return { problems: withLock(ctx.root, () => settle(ctx, input, { allowed, verify, others: call.others }, found, restored)) };
}
