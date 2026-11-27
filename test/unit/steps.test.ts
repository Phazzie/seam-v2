import { describe, expect, test } from 'vitest';
import { parseSource } from '../../src/lib/codeprint.ts';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { analyzeSteps } from '../../src/lib/stepprint.ts';

describe('step markers in a file', () => {
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

  test('functions in object literals and classes are named for what holds them, so they never share a name with a top-level function', () => {
    const src = [
      'export function f(): void {\n  // Step 1: first\n}',
      'const o = { f() {\n  // Step 1: second\n} };',
      'const g = { f: () => {\n  // Step 1: third\n} };',
      'const h = function f() {\n  // Step 1: fourth\n};',
      'class K { f() {\n  // Step 1: fifth\n} }',
    ].join('\n');
    const { steps, ambiguous } = analyzeSteps(parseSource('f.ts', src));
    expect(Object.keys(steps)).toEqual(['f', 'o>f', 'g>f', 'h', 'K>f']);
    expect(ambiguous).toEqual([]);
  });

  test('the name of a function does not depend on where it is in the file', () => {
    const real = 'export function f(): void {\n  // Step 1: real\n}';
    const decoy = 'const o = { f() {\n  // Step 1: decoy\n} };';
    expect(analyzeSteps(parseSource('f.ts', [decoy, real].join('\n'))).steps.f).toEqual(['Step 1: real']);
    expect(analyzeSteps(parseSource('f.ts', [real, decoy].join('\n'))).steps.f).toEqual(['Step 1: real']);
  });

  test('two functions that still end up with the same name are reported as ambiguous', () => {
    const src = 'export function f(): void {\n  function d() {\n    // Step 1: a\n  }\n  function d() {\n    // Step 1: b\n  }\n}';
    const { steps, ambiguous } = analyzeSteps(parseSource('f.ts', src));
    expect(Object.keys(steps)).toEqual(['f>d', 'f>d#2']);
    expect(ambiguous).toEqual(['f>d']);
  });

  test('a marker in an unnamed callback given to a call counts for the function around it', () => {
    const src = [
      'export function f(items: number[]): void {',
      '  // Step 1: start',
      '  items.forEach((x) => {',
      '    // Step 2: inside an arrow callback',
      '  });',
      '  useEffect(function () {',
      '    // Step 3: inside a function callback',
      '  });',
      '  const wrapped = wrap(((y) => {',
      '    // Step 4: inside a callback in parentheses',
      '  }) as Cb);',
      '}',
    ].join('\n');
    expect(fingerprintCode('f.ts', src).steps).toEqual({
      f: ['Step 1: start', 'Step 2: inside an arrow callback', 'Step 3: inside a function callback', 'Step 4: inside a callback in parentheses'],
    });
  });

  test('a named function or an arrow kept in a name has its own steps, even when it is given to a call', () => {
    const src = [
      'export function f(): void {',
      '  run(function step() {',
      '    // Step 1: in a named function expression',
      '  });',
      '  const go = () => {',
      '    // Step 2: in a named arrow',
      '  };',
      '  (() => {',
      '    // Step 3: in an arrow that is called at once',
      '  })();',
      '}',
    ].join('\n');
    expect(fingerprintCode('f.ts', src).steps).toEqual({
      'f>(function step)': ['Step 1: in a named function expression'],
      'f>go': ['Step 2: in a named arrow'],
      'f>(anonymous)': ['Step 3: in an arrow that is called at once'],
    });
  });

  test('only plain spaces and tabs count as spacing: a non-breaking space makes it a different marker, or no marker', () => {
    const nbsp = String.fromCharCode(0xa0);
    expect(fingerprintCode('f.ts', 'export function f() {\n  // Step 1: a' + nbsp + 'b\n}').steps.f).toEqual(['Step 1: a' + nbsp + 'b']);
    expect(fingerprintCode('f.ts', 'export function f() {\n  //' + nbsp + 'Step 1: ab\n}').steps).toEqual({});
    expect(fingerprintCode('f.ts', 'export function f() {\n  // Step' + nbsp + '1: ab\n}').steps).toEqual({});
  });
});
