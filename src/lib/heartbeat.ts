// The heartbeat: every hook run is a check-in, kept in `.seam/heartbeat.json` as
// `{ "lastSeen": "<ISO time>", "gaps": [{ "from": "<ISO time>", "to": "<ISO time>" }] }`.
// In the build phase a check-in more than 10 minutes after the last one records a gap: the time
// the guard was not watching. `seam report` shows the gaps.
import { join } from 'node:path';
import { z } from 'zod';
import { loadJson } from '../formats/read.ts';
import { loadState } from '../formats/state.ts';
import { atomicWrite } from './atomic.ts';
import { withLock } from './store.ts';

export const HEARTBEAT_PATH = '.seam/heartbeat.json';
/** A silence longer than this, in the build phase, is a gap. */
export const HEARTBEAT_GAP_MS = 10 * 60 * 1000;

const When = z.string().refine((s) => Number.isFinite(Date.parse(s)), 'must be a date and time');
const GapSchema = z.strictObject({ from: When, to: When });
const HeartbeatSchema = z.strictObject({ lastSeen: When, gaps: z.array(GapSchema).default([]) });

export type Gap = z.infer<typeof GapSchema>;

/**
 * Is the project in the build phase? A state.json that cannot be read counts as yes: a gap is worth recording when the
 * phase is not known, and the check-in must not fail on it (it comes before the hook's repair of that very file, so
 * throwing here would lock the project for good after a quiet spell).
 */
function inBuild(root: string): boolean {
  try {
    return loadState(root)?.phase === 'build';
  } catch (err) {
    if (err instanceof Error) return true;
    throw err;
  }
}

/** Record a check-in at `now`. Adds a gap if the phase is `build` and the last check-in was long ago. */
export function touchHeartbeat(root: string, now: Date): void {
  withLock(root, () => {
    const saved = loadJson(HeartbeatSchema, root, HEARTBEAT_PATH);
    const gaps = [...(saved?.gaps ?? [])];
    // A lastSeen in the future (clock change) gives a negative silence, so it is never a gap.
    if (saved !== null && now.getTime() - Date.parse(saved.lastSeen) > HEARTBEAT_GAP_MS && inBuild(root)) {
      gaps.push({ from: new Date(saved.lastSeen).toISOString(), to: now.toISOString() });
    }
    atomicWrite(join(root, HEARTBEAT_PATH), `${JSON.stringify({ lastSeen: now.toISOString(), gaps }, null, 2)}\n`);
  });
}

/** The last check-in and the gaps recorded so far (oldest first), or null if there is no heartbeat file yet. */
export function readHeartbeat(root: string): { lastSeen: string; gaps: Gap[] } | null {
  return loadJson(HeartbeatSchema, root, HEARTBEAT_PATH);
}

/** The gaps recorded so far, oldest first. None if there is no heartbeat file yet. */
export function heartbeatGaps(root: string): Gap[] {
  return readHeartbeat(root)?.gaps ?? [];
}
