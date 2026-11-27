import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { fingerprintCode, hash, normalize } from '../../src/lib/fingerprint.ts';
import { formatHeader } from '../../src/formats/header.ts';
import { skeleton, total, planFile, TOTAL } from '../helpers/code.ts';

const { seam, file } = planFile(TOTAL);
const GREETING = planFile('src/greeting/Greeting.tsx');
const SKELETON = skeleton(seam, file);
const FILLED = total();
const STEPS = file.steps.map((text, i) => `Step ${i + 1}: ${text}`);

/** The fingerprint of `FILLED` with `from` replaced by `to` (and a failure if it matched nothing). */
function bent(from: string, to: string): ReturnType<typeof fingerprintCode> {
  expect(FILLED, `the sample has no "${from}" to change`).toContain(from);
  return fingerprintCode(TOTAL, FILLED.replace(from, to));
}

const GREETING_TSX = [
  formatHeader(GREETING.seam, GREETING.file),
  '',
  'export function Greeting(props: { name: string }): JSX.Element {',
  '  // Step 1: Read the name from the props',
  '  const name = props.name;',
  '  // Step 2: Build the greeting text from the name',
  '  const text = `Hello, ${name}!`;',
  '  // Step 3: Return a heading that shows the greeting text',
  '  return <h1>{text} // Step 9: in JSX text {/* // Step 8: in a JSX comment */}</h1>;',
  '}',
  '',
].join('\n');

describe('normalize and hash', () => {
  test('line endings become LF and a BOM is dropped', () => {
    expect(normalize('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    expect(normalize('\uFEFFa')).toBe('a');
  });

  test('hash is the sha256 of the normalized text, in hex', () => {
    expect(hash('a\r\nb')).toBe(createHash('sha256').update('a\nb').digest('hex'));
    expect(hash('a\r\nb')).toBe(hash('\uFEFFa\nb'));
    expect(hash('a\nb')).not.toBe(hash('a\nc'));
  });
});

describe('fingerprintCode', () => {
  test('records the header, the export, the steps and the imports of the practice total', () => {
    const print = fingerprintCode(TOTAL, FILLED);
    expect(print.kind).toBe('code');
    expect(print.header).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(print.exports)).toEqual(['total']);
    expect(print.exports.total).toMatch(/^[0-9a-f]{64}$/);
    expect(print.steps).toEqual({ total: STEPS });
    expect(print.plannedImports).toEqual([]);
  });

  test('the skeleton and the filled-in code fingerprint the same: only the body differs', () => {
    expect(fingerprintCode(TOTAL, FILLED)).toEqual(fingerprintCode(TOTAL, SKELETON));
  });

  test('CRLF and LF fingerprint the same', () => {
    expect(fingerprintCode('a.ts', FILLED.replace(/\n/g, '\r\n'))).toEqual(fingerprintCode('a.ts', FILLED));
    expect(fingerprintCode('a.ts', FILLED.replace(/\n/g, '\r'))).toEqual(fingerprintCode('a.ts', FILLED));
  });

  test('a BOM at the start changes nothing', () => {
    expect(fingerprintCode('a.ts', `\uFEFF${FILLED}`)).toEqual(fingerprintCode('a.ts', FILLED));
  });

  test('spacing and line breaks inside a signature do not matter, only what it says', () => {
    const same = bent('total(a: number, b: number): number', 'total(\n  a:number,\n  b : number,\n):number');
    expect(same.exports).toEqual(fingerprintCode(TOTAL, FILLED).exports);
  });

  test.each<[string, string, string]>([
    ['a parameter type', 'b: number)', 'b: string)'],
    ['a parameter name', 'a: number, b', 'x: number, b'],
    ['a default value', 'b: number)', 'b: number = 0)'],
    ['an optional mark', 'b: number)', 'b?: number)'],
    ['a return type', '): number', '): string'],
    ['an extra parameter', 'b: number)', 'b: number, c: number)'],
    ['async', 'export function', 'export async function'],
    ['a type parameter', 'function total(', 'function total<T>('],
  ])('a change to %s changes the export hash', (_name, from, to) => {
    expect(bent(from, to).exports.total).not.toBe(fingerprintCode(TOTAL, FILLED).exports.total);
  });

  test('the header hash changes with any change inside the header, and the header is the first comment only', () => {
    const base = fingerprintCode(TOTAL, FILLED).header;
    expect(bent('Purpose: Add', 'Purpose: add').header).not.toBe(base);
    expect(bent(' * Promises:', ' */\n/**\n * Promises:').header).not.toBe(base);
    expect(fingerprintCode(TOTAL, `// hello\n${FILLED}`).header).toBe('');
    expect(fingerprintCode(TOTAL, FILLED.replace('/**', '/*')).header).toBe('');
    expect(fingerprintCode(TOTAL, FILLED.slice(FILLED.indexOf('export'))).header).toBe('');
  });

  test('step markers are read from comments only, never from strings, templates or JSX text', () => {
    const src = [
      'export function f(): string {',
      '  const a = "// Step 1: in a string";',
      '  const b = `// Step 2: in a template ${a}`;',
      '  /* // Step 3: inside a block comment */',
      '  // Step 4: a real marker',
      '  return a + b;',
      '}',
    ].join('\n');
    expect(fingerprintCode('f.ts', src).steps).toEqual({ f: ['Step 4: a real marker'] });
  });

  test('a marker is read wherever the comment sits in the body: before a statement, after one, or alone', () => {
    const src = [
      'export function f(x: number): number {',
      '  if (x) {',
      '    // Step 1: inside a block',
      '    x += 1; // Step 2: after a statement',
      '  }',
      '  // Step 3: last thing in the body',
      '}',
      'export function g(): void {',
      '  // Step 1: the only thing in an empty body',
      '}',
    ].join('\n');
    expect(fingerprintCode('f.ts', src).steps).toEqual({
      f: ['Step 1: inside a block', 'Step 2: after a statement', 'Step 3: last thing in the body'],
      g: ['Step 1: the only thing in an empty body'],
    });
  });

  test('marker text is compared with its spaces squeezed, so only real changes show', () => {
    const src = 'export function f(): void {\n  //   Step  1 :   take   the   price\n}\n';
    expect(fingerprintCode('f.ts', src).steps).toEqual({ f: ['Step 1: take the price'] });
  });

  test('a marker belongs to the nearest function around it, and keeps its own name', () => {
    const src = [
      'export function outer(): void {',
      '  // Step 1: in outer',
      '  const go = () => {',
      '    // Step 2: in an arrow',
      '  };',
      '  function inner() {',
      '    // Step 3: in a nested function',
      '  }',
      '  go(); inner();',
      '}',
      'export const arrow = (): void => {',
      '  // Step 1: in an exported arrow',
      '};',
      'class Box {',
      '  open(): void {',
      '    // Step 1: in a method',
      '  }',
      '}',
      'void Box;',
    ].join('\n');
    expect(fingerprintCode('f.ts', src).steps).toEqual({
      outer: ['Step 1: in outer'],
      'outer>go': ['Step 2: in an arrow'],
      'outer>inner': ['Step 3: in a nested function'],
      arrow: ['Step 1: in an exported arrow'],
      'Box>open': ['Step 1: in a method'],
    });
  });

  test('two functions with the same name get separate entries', () => {
    const src = [
      'export function f(): void {\n  // Step 1: first\n}',
      'const o = { f() {\n  // Step 1: second\n} };',
      'void o;',
    ].join('\n');
    expect(Object.keys(fingerprintCode('f.ts', src).steps)).toEqual(['f', 'f#2']);
  });

  test('TSX screen: header + steps fingerprinted', () => {
    const print = fingerprintCode('G.tsx', GREETING_TSX);
    expect(Object.keys(print.steps)).toEqual(['Greeting']);
    expect(print.steps.Greeting).toHaveLength(3);
    expect(print.header).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(print.exports)).toEqual(['Greeting']);
    expect(print).toEqual(fingerprintCode('G.tsx', skeleton(GREETING.seam, GREETING.file)));
  });

  test('plannedImports lists every module the file pulls in, sorted, once each', () => {
    const src = [
      "import { b } from 'zeta';", "import a from 'alpha';", "import 'side-effect';",
      "import type { T } from 'alpha';", "export { q } from './reexport';", "import fs = require('node:fs');",
      'void a; void b; export const x = 1; export type U = T; void fs;',
    ].join('\n');
    expect(fingerprintCode('f.ts', src).plannedImports).toEqual(['./reexport', 'alpha', 'node:fs', 'side-effect', 'zeta']);
  });
});
