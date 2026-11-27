// Who is acting, from the hook input. Claude Code reports a plugin's agents as `<plugin>:<agent>`
// (live check a) and sends neither `agent_type` nor `agent_id` for the main session (live check b).
import type { HookInput, Role } from '../types.ts';

const SEAM_ROLES: Record<string, Role> = {
  'seam-v2:builder': 'builder',
  'seam-v2:describer': 'describer',
  'seam-v2:checker': 'checker',
  'seam-v2:surveyor': 'surveyor',
  'seam-v2:design': 'design',
};

/**
 * `main` only when the input names no agent at all. One of the five seam agents gets its own
 * role. Everything else (another plugin's agent, a built-in like `general-purpose`, an agent_id
 * with no type, a type that is not text) is `readonly`: the least it can be trusted with.
 */
export function roleOf(input: HookInput): Role {
  const type: unknown = input.agent_type;
  if (type === undefined) return input.agent_id === undefined ? 'main' : 'readonly';
  return typeof type === 'string' && Object.hasOwn(SEAM_ROLES, type) ? SEAM_ROLES[type] : 'readonly';
}
