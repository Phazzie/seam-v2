// The code rules that need no special setup: the any type, ts-ignore, the 200-line limit, files that
// do not parse, and files that are not scripts. Silent catches, banned calls and contracts have their own files.
import { describe, expect, test } from 'vitest';
import { codeRuleProblems } from '../../src/lib/rules.ts';

const check = (text: string, path = 'src/app/x.ts'): string[] => codeRuleProblems(path, text);
const ANY = ['uses the any type'];
const IGNORE = ['uses ts-ignore'];

describe('the any type', () => {
  test.each([
    'const a: any = 1;', 'const a = b as any;', 'let a: Array<any>;', 'const f = (a: any) => a;',
    'type T = Record<string, any>;', 'function f(): any { return 1; }', 'let a: any[];', 'const a = <any>b;',
  ])('%s is refused', (src) => expect(check(src)).toEqual(ANY));

  test('says it once, however many there are', () => expect(check('let a: any; let b: any;')).toEqual(ANY));

  test.each([
    'let a: unknown;', '// any', '/* any */', "const s = 'any';", 'const s = `any`;', 'const any = 1;', 'const a = x.any;',
    "type T = 'any' | 'some';", 'let a: Record<string, unknown>;',
  ])('%s is fine', (src) => expect(check(src)).toEqual([]));
});

describe('ts-ignore', () => {
  test.each([
    ['a line comment', '// @ts-ignore\nconst a: number = "x";'],
    ['no space after the slashes', '//@ts-ignore because\nconst a = 1;'],
    ['a block comment', '/* @ts-ignore */\nconst a = 1;'],
    ['ts-nocheck', '// @ts-nocheck\nconst a = 1;'],
    ['ts-expect-error', 'const a = 1;\n// @ts-expect-error\nconst b: number = "x";'],
    ['a trailing comment', 'const a: number = "x"; // @ts-ignore'],
    ['a line of a block comment', '/*\n * @ts-ignore\n */\nconst a = 1;'],
    ['inside a function', 'function f() {\n  // @ts-ignore\n  g();\n}'],
    ['just before a closing brace', 'function f() {\n  g();\n  // @ts-ignore\n}'],
    ['mid-line block comment', 'const a = /* @ts-ignore */ 1;'],
  ])('%s is refused', (_name, src) => expect(check(src)).toEqual(IGNORE));

  test.each([
    ['a string', "const s = '// @ts-ignore';"],
    ['a template', 'const s = `\n// @ts-ignore\n`;'],
    ['a regular expression', 'const r = /\\/\\/ @ts-ignore/;'],
    ['a sentence in a comment', '// we never write @ts-ignore here\nconst a = 1;'],
    ['ts-check', '// @ts-check\nconst a = 1;'],
    ['a longer word', '// @ts-ignored\nconst a = 1;'],
  ])('%s is fine', (_name, src) => expect(check(src)).toEqual([]));

  test('text in a JSX element is not a comment', () => {
    expect(check('export const a = <p>// @ts-ignore</p>;', 'src/a.tsx')).toEqual([]);
    expect(check('export const a = <p>x</p>; // @ts-ignore', 'src/a.tsx')).toEqual(IGNORE);
  });
});

describe('the line limit', () => {
  const lines = (n: number, eol = '\n'): string => Array.from({ length: n }, (_, i) => `const a${i} = ${i};`).join(eol) + eol;

  test('200 lines is fine and 201 is not', () => {
    expect(check(lines(200))).toEqual([]);
    expect(check(lines(201))).toEqual(['is 201 lines; the limit is 200']);
  });

  test('names the real count', () => expect(check(lines(231))).toEqual(['is 231 lines; the limit is 200']));

  test('a missing last newline, Windows line endings and a byte-order mark change nothing', () => {
    expect(check(lines(200).trimEnd())).toEqual([]);
    expect(check(lines(200, '\r\n'))).toEqual([]);
    expect(check(`﻿${lines(200)}`)).toEqual([]);
    expect(check(lines(201, '\r\n'))).toEqual(['is 201 lines; the limit is 200']);
    expect(check(lines(201).trimEnd())).toEqual(['is 201 lines; the limit is 200']);
  });

  test('an empty file is fine', () => expect(check('')).toEqual([]));
});

describe('files that do not parse, and files that are not scripts', () => {
  test('a file that does not parse is refused, saying so', () => {
    const [problem, ...rest] = check('const = ;\n');
    expect(problem).toMatch(/^the file doesn't parse: .* \(line 1\)$/);
    expect(rest).toEqual([]);
  });

  test('json and sql are not read as scripts', () => {
    const big = `${'{ "a": 1 }\n'.repeat(300)}`;
    expect(codeRuleProblems('data/seed.json', big)).toEqual([]);
    expect(codeRuleProblems('db/seed.sql', 'select any from x;\n'.repeat(300))).toEqual([]);
  });

  test.each(['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.mts', 'a.cts', 'A.TS', 'a.ts.', 'a'])('%s is read', (path) => {
    expect(codeRuleProblems(`src/${path}`, '// @ts-ignore\n')).toEqual(IGNORE);
  });

  test('problems come out in a steady order, each once', () => {
    const src = ['// @ts-ignore', 'let a: any;', 'try { f(); } catch {}', "const x = require('y');", 'const e = process.env;'];
    expect(check(src.join('\n'))).toEqual([
      'uses the any type', 'uses ts-ignore', 'has a silent catch', 'reads process.env outside src/config',
      'uses fs/require/dynamic import, which builder code may not',
    ]);
  });
});
