// Placeholder, replaced in Task 11 by the real read decision. Until then every read is allowed,
// so nothing here may be relied on to stop anything.
import type { Ctx, Decision, HookInput } from '../types.ts';

export function decideRead(input: HookInput, ctx: Ctx): Decision {
  return { kind: 'allow' };
}
