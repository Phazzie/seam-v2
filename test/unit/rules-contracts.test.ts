// The contracts rule: a contract holds schemas and types, never code. Any function that has a body
// is code, and the message names the call it was handed to when there is one.
import { describe, expect, test } from 'vitest';
import { contractProblems } from '../../src/lib/rules.ts';

const found = (where = ''): string => `contracts may not contain code (found a function${where})`;

describe('contracts hold no code', () => {
  test('a plain schema is fine', () => {
    expect(contractProblems('z.object({ a: z.string().min(3) })')).toEqual([]);
    expect(contractProblems("import { z } from 'zod';\nexport const Id = z.string().uuid().optional();\nexport type Id = z.infer<typeof Id>;\n")).toEqual([]);
  });

  test.each([
    ['.refine', 'export const A = z.string().refine(s => s.length > 2);'],
    ['.refine', 'export const A = z.object({ a: z.string().refine((s) => s.length > 2) });'],
    ['.transform', 'export const A = z.string().transform(function (s) { return s; });'],
    ['.superRefine', 'export const A = z.string().superRefine((s, ctx) => { ctx.addIssue(s); });'],
    ['.preprocess', 'export const A = z.preprocess(v => v, z.string());'],
    ['.default', "export const A = z.string().default(() => 'x');"],
    ['.object', 'export const A = z.object({ f: () => 1 });'],
    ['.refine', 'export const A = z.string().refine(async (s) => (await check(s)) as boolean);'],
  ])('a function in %s is refused, naming it', (name, src) => expect(contractProblems(src)).toEqual([found(` in ${name}`)]));

  test('a function handed to a plain call is named with its brackets', () => {
    expect(contractProblems('export const A = wrap(() => 1);')).toEqual([found(' in wrap()')]);
  });

  test.each([
    'export function f() { return 1; }', 'export const f = () => 1;', 'export const f = function () {};', '(() => 1)();',
    'export class A { m() { return 1; } }', 'export class A { get x() { return 1; } }', 'export class A { set x(v: number) {} }',
    'export class A { constructor() { this.x = 1; } x = 0; }', 'export const o = { m() { return 1; } };',
    'export const o = { get x() { return 1; } };',
  ])('%s is refused as a function with no call around it', (src) => expect(contractProblems(src)).toEqual([found()]));

  test('types that describe functions are not code', () => {
    const src = [
      'export type F = (a: number) => string;', 'export interface I { m(a: number): void; (a: number): string; new (a: number): I }',
      'export declare function g(a: number): void;', 'export abstract class A { abstract m(): void }',
      'export function over(a: string): string;', 'export const S = z.object({ a: z.string() }).strict();',
    ].join('\n');
    expect(contractProblems(src)).toEqual([]);
  });

  test('every different problem is listed once', () => {
    const src = 'export const A = z.string().refine(s => s);\nexport const B = z.string().refine(s => !s);\nexport const C = z.string().transform(s => s);\nexport function f() {}';
    expect(contractProblems(src)).toEqual([found(' in .refine'), found(' in .transform'), found()]);
  });

  test('a function inside a function is one problem, named by the outer one', () => {
    expect(contractProblems('export const A = z.string().refine(s => { const g = () => s; return g(); });')).toEqual([found(' in .refine')]);
  });

  test('the words in a comment or a string do not count', () => {
    expect(contractProblems("// z.string().refine(s => s)\nexport const A = z.literal('() => 1');\n")).toEqual([]);
  });

  test('a contract that does not parse is refused', () => {
    expect(contractProblems('export const = ;')[0]).toMatch(/^the file doesn't parse: /);
  });
});
