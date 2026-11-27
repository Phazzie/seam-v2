// Placeholder, replaced in Task 9 by the real write decision (the role table). Until then every
// write is allowed, so nothing here may be relied on to stop anything.
import type { Ctx, Decision, HookInput } from '../types.ts';

export function decideWrite(input: HookInput, ctx: Ctx): Decision {
  return { kind: 'allow' };
}
