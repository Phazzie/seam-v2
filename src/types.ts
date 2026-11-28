// Shared types for the guard and the seam command. The file formats (Plan, SeamState,
// Lock) live in src/formats/; they are imported here as types only.
import type { Lock } from './formats/lock.ts';
import type { Plan } from './formats/plan.ts';
import type { SeamState } from './formats/state.ts';

/** The phases of a seam project, in order. `.seam/state.json` stores one of these. */
export const PHASES = [
  'setup', 'survey', 'plan1', 'probe', 'plan2', 'skeleton', 'tests', 'build', 'flip', 'cutover',
] as const;
export type Phase = (typeof PHASES)[number];

/** Who is acting. Worked out from the hook input (agent_type is `<plugin>:<agent>`). */
export type Role = 'main' | 'builder' | 'describer' | 'checker' | 'surveyor' | 'design' | 'readonly';

/** What Claude Code sends a hook on stdin. */
export interface HookInput {
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  /** A PostToolUseFailure carries the failure here instead of a `tool_response`; everything else about it is as for a PostToolUse. */
  error?: unknown;
  is_interrupt?: boolean;
  /** Claude Code's id for one tool call: the same in its PreToolUse and its PostToolUse. */
  tool_use_id?: string;
  agent_id?: string;
  agent_type?: string;
  cwd: string;
  session_id?: string;
}

/** The guard either stays silent (allow) or refuses with a plain-English reason. */
export type Decision = { kind: 'allow' } | { kind: 'deny'; reason: string };

/** Everything a guard decision needs, loaded once per hook run. */
export interface Ctx {
  root: string;
  appRoot: string;
  dataDir: string;
  pluginRoot: string;
  state: SeamState;
  plan: Plan | null;
  lock: Lock | null;
  now: Date;
  /** The old app, from .seam/env.json, when the plan names none (R80). The plan's own `legacyRoot` wins when it has one. */
  legacyRoot?: string | null;
}
