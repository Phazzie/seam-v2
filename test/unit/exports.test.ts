import { describe, expect, test } from 'vitest';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';

describe('what counts as an export', () => {
  const names = (src: string): string[] => Object.keys(fingerprintCode('f.ts', src).exports).sort();

  test('functions, classes, constants, types, interfaces, enums and namespaces', () => {
    const src = [
      'export function a() {}', 'export class B {}', 'export const c = 1, d = 2;', 'export type E = string;',
      'export interface F {}', 'export enum G { X }', 'export namespace H {}', 'export const { i, j: [k] } = x;',
      'declare const x: { i: number; j: number[] };', 'function private1() {}', 'const private2 = 1;',
    ].join('\n');
    expect(names(src)).toEqual(['B', 'E', 'F', 'G', 'H', 'a', 'c', 'd', 'i', 'k']);
  });

  test('an exported arrow function has a signature that ignores its body', () => {
    const arrow = (body: string): string => `export const f = (a: number): number => ${body};`;
    const base = fingerprintCode('f.ts', arrow('a + 1'));
    expect(fingerprintCode('f.ts', arrow('{ return a * 2; }'))).toEqual(base);
    expect(fingerprintCode('f.ts', 'export const f = (a: string): number => 1;').exports.f).not.toBe(base.exports.f);
    expect(fingerprintCode('f.ts', 'export const f = function (a: number): number { return 1; };').exports.f)
      .not.toBe(base.exports.f);
  });

  test('a constant keeps its value as part of what is fingerprinted', () => {
    expect(fingerprintCode('f.ts', 'export const RATE = 1;').exports.RATE)
      .not.toBe(fingerprintCode('f.ts', 'export const RATE = 2;').exports.RATE);
  });

  test('export default, named and anonymous, is the export called default', () => {
    expect(names('export default function total(a: number) { return a; }')).toEqual(['default']);
    expect(names('export default function () {}')).toEqual(['default']);
    expect(names('export default 42;')).toEqual(['default']);
  });

  test('export { x }, export { x as y } and re-exports are exports under the name the importer sees', () => {
    const src = [
      'function x() {}', 'const z = 1;', "import { w } from 'm';", 'export { x, x as y, z, w };',
      "export { r } from './r';", "export { s as t } from './s';", "export * as ns from './ns';", "export * from './all';",
    ].join('\n');
    expect(names(src)).toEqual(['* from ./all', 'ns', 'r', 't', 'w', 'x', 'y', 'z']);
  });

  test('exporting a private function by name has the same hash as declaring it exported', () => {
    const declared = fingerprintCode('f.ts', 'export function x(a: number): number { return a; }').exports.x;
    expect(fingerprintCode('f.ts', 'function x(a: number): number { return a; }\nexport { x };').exports.x).toBe(declared);
    expect(fingerprintCode('f.ts', 'function x(a: string): number { return 1; }\nexport { x };').exports.x).not.toBe(declared);
  });

  test('a class keeps its method signatures but not their bodies', () => {
    const cls = (body: string): string => `export class Cart { add(n: number): void ${body} get size(): number { return 1; } }`;
    expect(fingerprintCode('f.ts', cls('{ this.n = n; }'))).toEqual(fingerprintCode('f.ts', cls('{ }')));
    expect(fingerprintCode('f.ts', cls('{}').replace('n: number', 'n: string')).exports.Cart)
      .not.toBe(fingerprintCode('f.ts', cls('{}')).exports.Cart);
  });

  test('overloads count together with their implementation', () => {
    const src = 'export function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: unknown) { return a; }';
    expect(names(src)).toEqual(['f']);
    expect(fingerprintCode('f.ts', src.replace('a: number): number', 'a: boolean): number')).exports.f)
      .not.toBe(fingerprintCode('f.ts', src).exports.f);
  });
});
