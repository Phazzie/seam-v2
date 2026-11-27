// The state file: .seam/state.json. Where the project is, whose turn it is, and the record
// of strikes, parked files, approvals and blocks. Only scripts write it.
import { z } from 'zod';
import { PHASES } from '../types.ts';
import { loadJson, parseWith } from './read.ts';

export const STATE_PATH = '.seam/state.json';

export const ApprovalRecordSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(['features', 'freeze', 'flips', 'cutover', 'reopen', 'park', 'edit']),
  at: z.string(),
  fingerprints: z.record(z.string(), z.string()),
  summary: z.string(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const SeamStateSchema = z.strictObject({
  version: z.literal(1),
  phase: z.enum(PHASES),
  /** Whose turn it is: the builder's agent id, the file it is filling, and when it began. */
  turn: z.strictObject({
    agentId: z.string().nullable(),
    file: z.string().nullable(),
    startedAt: z.string().nullable(),
  }),
  strikes: z.record(z.string(), z.number().int().nonnegative()),
  parked: z.array(z.string()),
  /** Files finished and accepted, for `seam report`. Older state files without it load as empty. */
  done: z.array(z.string()).default([]),
  approvals: z.array(ApprovalRecordSchema),
  blocks: z.number().int().nonnegative(),
  halted: z.string().nullable(),
});
export type SeamState = z.infer<typeof SeamStateSchema>;

/** Check state data that is already parsed. Throws a plain-English error if it doesn't fit. */
export function parseState(raw: unknown, label = 'the state'): SeamState {
  return parseWith(SeamStateSchema, raw, label);
}

/** Read `<root>/.seam/state.json`. Null if absent; throws if present but unreadable or invalid. */
export function loadState(root: string): SeamState | null {
  return loadJson(SeamStateSchema, root, STATE_PATH);
}
