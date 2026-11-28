// The code rules, applied to our own source (the builders' rules in src/lib/rules.ts are for the owner's app code):
// a file is at most 200 lines, only src/config/ reads the environment, no `any`, no silent catch, and a regex or string
// never holds a literal U+FEFF (an invisible character in source hides what a pattern matches; write its escape).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC = resolve(import.meta.dirname, '../../src');
const BOM = String.fromCharCode(0xfeff);

const files: { rel: string; text: string }[] = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.ts'))
  .map((e) => {
    const abs = join(e.parentPath, e.name);
    return { rel: relative(SRC, abs).replace(/\\/g, '/'), text: readFileSync(abs, 'utf8') };
  });

/** The code with its comments and its single-quoted strings taken out, so a rule that talks about `any` or `catch {}` is not mistaken for code that does. */
const bare = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");

describe('the code rules hold in src/', () => {
  test('there are source files to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  test.each(files.map((f) => [f.rel, f.text] as const))('%s is at most 200 lines, has no literal U+FEFF, no `any`, no silent catch', (_rel, text) => {
    expect(text.split('\n').length, 'more than 200 lines').toBeLessThanOrEqual(201);
    expect(text.includes(BOM), 'a literal U+FEFF in the source').toBe(false);
    const code = bare(text);
    expect(/(?::|\bas|<)\s*any\b/.test(code), 'the type any').toBe(false);
    expect(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(code), 'an empty catch').toBe(false);
  });

  test('only src/config/ reads process.env', () => {
    const readers = files.filter((f) => !f.rel.startsWith('config/') && /\bprocess\.env\b/.test(bare(f.text)));
    expect(readers.map((f) => f.rel)).toEqual([]);
  });
});
