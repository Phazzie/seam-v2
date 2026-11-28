// Placeholder, replaced in Task 10 by the real command allowlist. Until then every command is
// allowed, so nothing here may be relied on to stop anything.
import type { Ctx, Decision, HookInput } from '../types.ts';

export function decideCommand(input: HookInput, ctx: Ctx): Decision {
  return { kind: 'allow' };
}
