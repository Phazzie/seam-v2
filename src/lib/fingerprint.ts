// Stub, replaced in Task 6 by the real lock writer. It exists now so the cheat-test helper
// can import it; every cheat that needs a lock fails with "not implemented" until then.
import type { Lock } from '../formats/lock.ts';
import type { Plan } from '../formats/plan.ts';

/** Fingerprint the plan's files and write `<root>/.seam/lock.json`. */
export function writeLock(root: string, plan: Plan): Lock {
  throw new Error('not implemented');
}
