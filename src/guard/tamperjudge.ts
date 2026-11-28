// Settling one finding, under the lock: it is nothing (a file only touched, or a harmless code file), a change
// the guard allowed (a file tool it let through, or the turn builder's own file with its body filled in), or a
// tamper, which is put back (a file that was there) or moved aside (a file that was not).
import { logLine } from '../lib/log.ts';
import type { Ctx } from '../types.ts';
import { putBack, moveAside } from './tamperfix.ts';
import { absOf, fold, hashOf, measure } from './tamperrecord.ts';
import type { Entry, TamperRecord } from './tamperrecord.ts';
import { look } from './tamperscan.ts';
import type { Finding } from './tamperscan.ts';
import { SWITCH_OFF, checkSettings } from './tampersettings.ts';
import type { Verifier } from './tamperbuilder.ts';
import { takeIn } from './tampertake.ts';

/** What one check is judging with. */
export interface Case {
  ctx: Ctx;
  rec: TamperRecord;
  /** Files this call was allowed to change (from the repo root, folded). */
  allowed: ReadonlySet<string>;
  /** Whether the call is the turn builder's, and which file is its own (folded). */
  builder: boolean;
  turn: string | null;
  verify: Verifier | null;
}

/** A tamper, in plain words. `halt` words the halt when the cause is something other than a protected file changed. */
export interface Verdict { problem: string; key: string; halt?: string }

export const PUT_BACK = 'outside the rules and has been put back';

/** Put a recorded file back; the verdict says so, or says why it could not be. */
function undo(c: Case, key: string, abs: string, entry: Entry, verb: string, why = ''): Verdict {
  const back = putBack(c.ctx, abs, entry);
  if (typeof back === 'string') return { key, problem: `${key} was ${verb} outside the rules and could not be put back (${back})` };
  c.rec.files[key] = back;
  logLine(c.ctx.root, `Put back ${key}, which was ${verb} outside the rules.`);
  return { key, problem: `${key} was ${verb} ${PUT_BACK}${why === '' ? '' : ` (${why})`}` };
}

function judgeKnown(c: Case, key: string, abs: string, entry: Entry): Verdict | null {
  const now = look(abs);
  if (now !== null) {
    // A file of another size is changed, and is not read at all: a huge replacement is put back, never hashed whole.
    if (now.size === entry.size && hashOf(abs) === entry.hash) {
      c.rec.files[key] = { ...entry, size: now.size, mtimeMs: now.mtimeMs }; // only touched
      return null;
    }
    if (c.allowed.has(fold(key))) {
      c.rec.files[key] = measure(c.ctx, abs);
      return null;
    }
    if (c.builder && c.turn === fold(key)) {
      const why = c.verify?.(key, abs) ?? ['it could not be checked against the lock'];
      if (why.length === 0) {
        c.rec.files[key] = measure(c.ctx, abs);
        return null;
      }
      return undo(c, key, abs, entry, 'changed', why.join('; '));
    }
  }
  return undo(c, key, abs, entry, now === null ? 'deleted' : 'changed');
}

/** Move a new file that has no place there out of the project. */
function aside(c: Case, key: string, abs: string): Verdict {
  const moved = moveAside(c.ctx, key, abs);
  if (typeof moved === 'string') return { key, problem: `${key} is a new file that has no place there and could not be moved aside (${moved})` };
  logLine(c.ctx.root, `Moved ${key} aside (a new file with no place there) to ${moved.to}`);
  return { key, problem: `${key} is a new file that has no place there${moved.big ? ' (over 2 MB)' : ''} and has been moved aside` };
}

function judgeNew(c: Case, key: string, abs: string): Verdict | null {
  if (look(abs) === null) return null; // gone again
  if (!c.allowed.has(fold(key))) return aside(c, key, abs);
  takeIn(c.ctx, c.rec, key);
  return null;
}

/**
 * The one protected file that Claude Code itself writes: when the owner answers "don't ask again" to a permission
 * prompt it saves the answer to `.claude/settings.local.json`. A change to it is taken into the record, with a line in
 * the log, only when every setting that changed is `permissions` or an MCP approval (tampersettings.ts). Any other change, or a file that
 * is not a JSON object, is put back (or moved aside, if the file is new) and halts the run. (The write decision still
 * refuses the AI's own writes to it.)
 */
const OWNER_SETTINGS = /^\.claude\/settings\.local\.json$/i;

function judgeSettings(c: Case, key: string, abs: string): Verdict | null {
  const entry = c.rec.files[key];
  const now = look(abs);
  if (entry === undefined && now === null) return null;
  if (entry !== undefined && now !== null && now.size === entry.size && hashOf(abs) === entry.hash) {
    c.rec.files[key] = { ...entry, size: now.size, mtimeMs: now.mtimeMs }; // only touched
    return null;
  }
  const { problem, updated } = checkSettings(c.ctx, entry, now === null ? null : abs);
  if (problem === null) {
    takeIn(c.ctx, c.rec, key);
    logLine(c.ctx.root, `Claude Code updated ${updated} in ${key}`);
    return null;
  }
  const verdict = entry === undefined ? aside(c, key, abs) : undo(c, key, abs, entry, now === null ? 'deleted' : 'changed', problem);
  return { ...verdict, halt: SWITCH_OFF };
}

/** Settle one finding against the record as it is now. Null means there is nothing to report. */
export function judge(c: Case, found: Finding): Verdict | null {
  const { key } = found;
  const abs = absOf(c.ctx, key);
  if (OWNER_SETTINGS.test(key)) return judgeSettings(c, key, abs);
  if (found.kind === 'newOther') {
    if (look(abs) !== null && !c.rec.code.includes(key)) c.rec.code.push(key);
    return null;
  }
  const entry = c.rec.files[key];
  return entry !== undefined ? judgeKnown(c, key, abs, entry) : judgeNew(c, key, abs);
}
