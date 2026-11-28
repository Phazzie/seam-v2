// The calls under way, in `.seam/inflight`. Tool calls can run side by side, so when the tamper check finds a
// change it has to know whether another call was running, or it would blame the wrong one (15.16). A write or a
// command is noted when the guard lets it start, with the files a write was allowed to change, and struck off
// when its PostToolUse comes. A note whose after-hook never came (the call was cancelled, the hook crashed)
// stops counting after ten minutes. The tools that have no before-hook (an MCP tool) are not noted.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWrite, errorCode } from '../lib/atomic.ts';
import { logLine } from '../lib/log.ts';
import { withLock } from '../lib/store.ts';
import type { Ctx, HookInput } from '../types.ts';

export const INFLIGHT_PATH = '.seam/inflight';
/** A call this old is taken to be over. */
const STALE_MS = 10 * 60 * 1000;
/** The tools whose calls are noted: the ones that can change a file and have a before-hook. */
const NOTED_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']);

const CallsSchema = z.array(z.strictObject({ id: z.string(), at: z.number(), paths: z.array(z.string()) }));
type Calls = z.infer<typeof CallsSchema>;

/** The id of one call: Claude Code's own, or (when it sends none) a short code of who ran what, the same before and after. */
export function callId(input: HookInput): string {
  if (typeof input.tool_use_id === 'string' && input.tool_use_id !== '') return input.tool_use_id;
  return createHash('sha256').update(JSON.stringify([input.agent_id ?? '', input.tool_name, input.tool_input])).digest('hex').slice(0, 16);
}

/** The calls noted and not yet struck off, without the stale ones. A missing file is no calls under way; one that cannot be read is started again, and the log says so. */
function readCalls(ctx: Ctx): Calls {
  let text: string;
  try {
    text = readFileSync(join(ctx.root, INFLIGHT_PATH), 'utf8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return [];
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    logLine(ctx.root, `The note of calls under way could not be read, so it was started again (${(err as Error).message}).`);
    return [];
  }
  const parsed = CallsSchema.safeParse(raw);
  const fresh = ctx.now.getTime() - STALE_MS;
  return parsed.success ? parsed.data.filter((call) => call.at > fresh) : [];
}

const save = (ctx: Ctx, calls: Calls): void => atomicWrite(join(ctx.root, INFLIGHT_PATH), `${JSON.stringify(calls)}\n`);

/** Note that a call was allowed to start. `paths` are the files it may change (from the repo root, folded). */
export function started(ctx: Ctx, input: HookInput, paths: string[]): void {
  withLock(ctx.root, () => {
    save(ctx, [...readCalls(ctx).filter((call) => call.id !== callId(input)), { id: callId(input), at: ctx.now.getTime(), paths }]);
  });
}

export interface Finished { paths: string[]; others: number; otherPaths: string[] }

/**
 * A call is over. Returns the files it was allowed to change (none if it was never noted: the guard did not
 * allow it, or its before-hook crashed), how many other calls are still under way, and the files those were allowed to
 * change: a write of theirs may already be on disk, and it is theirs to accept when their own after-hook comes.
 */
export function finished(ctx: Ctx, input: HookInput): Finished {
  const id = callId(input);
  const done = (calls: Calls): Finished => {
    const others = calls.filter((call) => call.id !== id);
    return { paths: calls.find((call) => call.id === id)?.paths ?? [], others: others.length, otherPaths: others.flatMap((call) => call.paths) };
  };
  if (!NOTED_TOOLS.has(input.tool_name ?? '')) return done(readCalls(ctx));
  return withLock(ctx.root, () => {
    const calls = readCalls(ctx);
    save(ctx, calls.filter((call) => call.id !== id));
    return done(calls);
  });
}
