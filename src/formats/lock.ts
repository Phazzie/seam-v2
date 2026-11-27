// The lock file: .seam/lock.json. Written at freeze. Code files are fingerprinted by named
// item (header, exports, steps, planned imports) so bodies can change; everything else
// (plan, contracts, tests, fixtures, config) is fingerprinted whole.
import { z } from 'zod';
import { loadJson, parseWith } from './read.ts';

export const LOCK_PATH = '.seam/lock.json';

export const FileLockSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('code'),
    header: z.string(),
    exports: z.record(z.string(), z.string()),
    // Every top-level type alias, interface and enum, exported or not, keyed `type X`, `interface X`, `enum X`.
    fixed: z.record(z.string(), z.string()).optional(),
    steps: z.record(z.string(), z.array(z.string())),
    plannedImports: z.array(z.string()),
  }),
  z.strictObject({ kind: z.literal('whole'), hash: z.string() }),
]);
export type FileLock = z.infer<typeof FileLockSchema>;

export const LockSchema = z.strictObject({
  version: z.literal(1),
  files: z.record(z.string(), FileLockSchema),
});
export type Lock = z.infer<typeof LockSchema>;

/** Check lock data that is already parsed. Throws a plain-English error if it doesn't fit. */
export function parseLock(raw: unknown, label = 'the lock'): Lock {
  return parseWith(LockSchema, raw, label);
}

/** Read `<root>/.seam/lock.json`. Null if absent; throws if present but unreadable or invalid. */
export function loadLock(root: string): Lock | null {
  return loadJson(LockSchema, root, LOCK_PATH);
}
