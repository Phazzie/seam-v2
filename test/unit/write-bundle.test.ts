// R47 in the real bundle: the chunk that holds the write decision reaches the TypeScript parser only through
// import(), so loading it is cheap. build.mjs refuses to build otherwise; this checks the files that were built.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const CHUNKS = resolve(import.meta.dirname, '../../dist/chunks');
const read = (name: string): string => readFileSync(join(CHUNKS, name), 'utf8');
const writeChunk = readdirSync(CHUNKS).find((f) => /^write-.*\.mjs$/.test(f)) ?? '';

/** The chunk files a chunk loads at once (`import ... from "./x.mjs"`), not the ones it loads later with import(). */
const staticImports = (text: string): string[] => [...text.matchAll(/(?:from|import)\s*"\.\/([\w.-]+\.mjs)"/g)].map((m) => m[1]);

function loadedAtOnce(start: string): string[] {
  const seen = new Set<string>();
  const todo = [start];
  for (let name = todo.pop(); name !== undefined; name = todo.pop()) {
    if (seen.has(name)) continue;
    seen.add(name);
    todo.push(...staticImports(read(name)));
  }
  return [...seen];
}

describe('the write decision in dist/chunks', () => {
  test('is a chunk of its own, and a small one', () => {
    expect(writeChunk, 'no write-*.mjs chunk in dist/chunks').not.toBe('');
    expect(read(writeChunk).length).toBeLessThan(50_000);
  });

  test('loads the lock check and the code rules with import(), later', () => {
    const later = [...read(writeChunk).matchAll(/import\("\.\/([\w.-]+\.mjs)"\)/g)].map((m) => m[1]);
    expect(later.some((f) => f.startsWith('lockcheck-'))).toBe(true);
    expect(later.some((f) => f.startsWith('rules-'))).toBe(true);
  });

  test('loads nothing at once that holds the TypeScript parser', () => {
    const together = loadedAtOnce(writeChunk);
    expect(together.length).toBeGreaterThan(1);
    for (const name of together) expect(read(name), `${name} holds the parser`).not.toContain('createSourceFile');
  });

  test('and the parser is where those later chunks load it from', () => {
    const later = [...read(writeChunk).matchAll(/import\("\.\/([\w.-]+\.mjs)"\)/g)].map((m) => m[1]);
    const withParser = later.flatMap((name) => loadedAtOnce(name)).filter((name) => read(name).includes('createSourceFile'));
    expect(withParser.length, 'the check above would pass for a bundle with no parser at all').toBeGreaterThan(0);
  });
});
