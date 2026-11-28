// `seam report`: where the project stands, on one screen, in plain English: the phase, how many files are done, parked and
// left, what the guard has said no to, when it was not watching, why a run is stopped, and what is waiting for the owner.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_PATH } from '../lib/log.ts';
import { HEARTBEAT_GAP_MS, readHeartbeat } from '../lib/heartbeat.ts';
import type { Ctx } from '../types.ts';
import { KIND_WORDS } from './moves.ts';
import { loadPending } from './pending.ts';
import { PHASE_WORDS } from './phases.ts';

/** How many blocks, parked files and gaps are listed before "and N more". */
const LAST_BLOCKS = 5;
const PARKED_SHOWN = 10;
const GAPS_SHOWN = 5;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** How long, in words, to the nearest minute: "less than a minute", "25 minutes", "2 hours 5 minutes", "1 day 2 hours". */
export function spanWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'less than a minute';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = days > 0 ? [plural(days, 'day'), hours > 0 ? plural(hours, 'hour') : ''] : [hours > 0 ? plural(hours, 'hour') : '', mins > 0 ? plural(mins, 'minute') : ''];
  return parts.filter((part) => part !== '').join(' ');
}

const two = (n: number): string => String(n).padStart(2, '0');
/** A moment as the owner reads it, in local time: `2026-11-28 14:03`. */
const stamp = (when: Date): string => `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())} ${two(when.getHours())}:${two(when.getMinutes())}`;

/** A path as the plan and the state may spell it: forward slashes, no leading `./`. */
const plain = (path: string): string => path.replace(/\\/g, '/').replace(/^\.\//, '');

function fileLines(ctx: Ctx): string[] {
  const { state, plan } = ctx;
  const lines: string[] = [];
  if (plan === null) {
    lines.push('Files: there is no plan yet, so there is nothing to count.');
  } else {
    const planned = plan.seams.flatMap((seam) => seam.files.map((f) => plain(f.path)));
    const done = new Set(state.done.map(plain));
    const parked = new Set(state.parked.map(plain));
    const counted = (set: Set<string>): number => planned.filter((path) => set.has(path)).length;
    const left = planned.filter((path) => !done.has(path) && !parked.has(path)).length;
    lines.push(`Files: ${counted(done)} done, ${counted(parked)} parked, ${left} left (${planned.length} planned).`);
  }
  if (state.turn.file !== null) lines.push(`Building now: ${state.turn.file}`);
  if (state.parked.length > 0) {
    lines.push('Parked (these need your decision):');
    lines.push(...state.parked.slice(0, PARKED_SHOWN).map((path) => `  - ${path}`));
    if (state.parked.length > PARKED_SHOWN) lines.push(`  - and ${state.parked.length - PARKED_SHOWN} more`);
  }
  return lines;
}

/** The "Blocked:" lines of the log, newest last: `10:47 main tried to ...`. */
function blockLines(root: string): string[] {
  const log = join(root, LOG_PATH);
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split(/\r?\n/).flatMap((line) => {
    const found = /^(\d\d:\d\d) Blocked: (.+)$/.exec(line);
    return found === null ? [] : [`${found[1]} ${found[2]}`];
  });
}

function blockSection(ctx: Ctx): string[] {
  const { blocks } = ctx.state;
  if (blocks === 0) return ['Blocks: the guard has not said no to anything yet.'];
  const last = blockLines(ctx.root).slice(-LAST_BLOCKS);
  return [`Blocks: the guard has said no ${plural(blocks, 'time')}. The last ${last.length}:`, ...last.map((line) => `  - ${line}`)];
}

/** The times the guard was not watching: the gaps in the heartbeat, and silence that is still going on in the build. */
function gapSection(ctx: Ctx, now: Date): string[] {
  const beat = readHeartbeat(ctx.root);
  const gaps = (beat?.gaps ?? []).map((g) => `gap from ${stamp(new Date(g.from))} to ${stamp(new Date(g.to))} (${spanWords(Date.parse(g.to) - Date.parse(g.from))})`);
  const silent = beat === null ? 0 : now.getTime() - Date.parse(beat.lastSeen);
  const going = ctx.state.phase === 'build' && silent > HEARTBEAT_GAP_MS;
  const total = gaps.length + (going ? 1 : 0);
  if (total === 0) return ['No gaps: the guard has been watching the whole time.'];
  const shown = gaps.slice(-GAPS_SHOWN);
  const lines = [`Heartbeat: ${plural(total, 'gap')}, times the guard was not watching:`];
  if (gaps.length > shown.length) lines.push(`  - and ${gaps.length - shown.length} earlier`);
  lines.push(...shown.map((line) => `  - ${line}`));
  if (going && beat !== null) lines.push(`  - gap still going: nothing has checked in for ${spanWords(silent)} (since ${stamp(new Date(beat.lastSeen))})`);
  return lines;
}

/** The whole report, as text. `now` is when it is read (a test hands in its own). */
export function renderReport(ctx: Ctx, now: Date): string {
  const { state } = ctx;
  const lines = ['Seam report', `Phase: ${state.phase}, ${PHASE_WORDS[state.phase]}.`];
  if (state.halted !== null) {
    lines.push(`STOPPED: ${state.halted}`, 'Nothing more will be built until you have looked into it. Ask Claude to request a "park" or an "edit" approval, then approve it in Seam Approve on your desktop.');
  }
  const pending = loadPending(ctx.root);
  if (pending !== null) lines.push(`Waiting for you: your approval to ${KIND_WORDS[pending.kind]}. Open Seam Approve on your desktop.`);
  lines.push('', ...fileLines(ctx), '', ...blockSection(ctx), '', ...gapSection(ctx, now));
  return lines.join('\n');
}
