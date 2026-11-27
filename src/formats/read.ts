// Shared reading and error wording for the three record files (plan, state, lock).
// Every failure is a plain sentence that names the file, because the owner reads these.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ZodError, ZodType } from 'zod';

/** One line per Zod issue, as `  - seams[0].files[0].steps: needs at least 3 steps`. */
export function explain(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.reduce<string>(
        (acc, key) => (typeof key === 'number' ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)),
        '',
      );
      return where ? `  - ${where}: ${issue.message}` : `  - ${issue.message}`;
    })
    .join('\n');
}

/** Check already-parsed data against a schema. `label` names the thing in the error. */
export function parseWith<T>(schema: ZodType<T>, raw: unknown, label: string): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(`${label} is invalid:\n${explain(result.error)}`);
}

/**
 * Read `<root>/<rel>` as JSON and check it. Returns null when the file does not exist.
 * Throws a plain-English error when it exists but cannot be read or does not fit the schema.
 */
export function loadJson<T>(schema: ZodType<T>, root: string, rel: string): T | null {
  let text: string;
  try {
    text = readFileSync(join(root, rel), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`${rel} is unreadable: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new Error(`${rel} is unreadable: it is not valid JSON (${(err as Error).message}).`);
  }
  return parseWith(schema, raw, rel);
}
