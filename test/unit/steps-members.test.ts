// A getter and a setter of one property, and a static member and an instance one of one name, are
// different functions: each has its own scope name, so honest code that has both is not called ambiguous.
import { describe, expect, test } from 'vitest';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { parseSource } from '../../src/lib/codeprint.ts';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { analyzeSteps } from '../../src/lib/stepprint.ts';
import { P, lockOf, plan } from '../helpers/lockcheck.ts';

const analyze = (src: string): ReturnType<typeof analyzeSteps> => analyzeSteps(parseSource('f.ts', src));
const body = (n: number, text: string): string => `{\n    // Step ${n}: ${text}\n  }`;

const ACCESSORS = [
  'export class Box {',
  `  get total(): number ${body(1, 'read the amount')}`,
  `  set total(v: number) ${body(1, 'store the amount')}`,
  '}',
].join('\n');

describe('a getter and a setter of one property', () => {
  test('have their own scope names, each with its own markers, and nothing is ambiguous', () => {
    const { steps, ambiguous } = analyze(ACCESSORS);
    expect(steps).toEqual({ 'Box>get total': ['Step 1: read the amount'], 'Box>set total': ['Step 1: store the amount'] });
    expect(ambiguous).toEqual([]);
  });

  test('a locked pair with a marker in each, filled in as locked, has no problems', () => {
    expect(checkAgainstLock(P, ACCESSORS, lockOf(ACCESSORS), plan)).toEqual([]);
  });

  test('a marker moved from the setter to the getter is still caught', () => {
    const moved = ACCESSORS.replace('store the amount', 'read the amount');
    expect(checkAgainstLock(P, moved, lockOf(ACCESSORS), plan)).toEqual(["step 1 in Box>set total was changed or removed"]);
  });

  test('in an object literal too', () => {
    const src = [
      'export const api = {',
      `  get total(): number ${body(1, 'read the amount')},`,
      `  set total(v: number) ${body(1, 'store the amount')},`,
      '};',
    ].join('\n');
    const { steps, ambiguous } = analyze(src);
    expect(Object.keys(steps)).toEqual(['api>get total', 'api>set total']);
    expect(ambiguous).toEqual([]);
  });

  test('two getters of one name in one class are still ambiguous', () => {
    const src = `export class Box {\n  get total(): number ${body(1, 'a')}\n  get total(): number ${body(1, 'b')}\n}`;
    expect(analyze(src).ambiguous).toEqual(['Box>get total']);
  });
});

describe('a static member and an instance member of one name', () => {
  const METHODS = [
    'export class Box {',
    `  static make(): void ${body(1, 'build one')}`,
    `  make(): void ${body(1, 'build another')}`,
    '}',
  ].join('\n');

  test('methods: distinct scope names, nothing ambiguous', () => {
    const { steps, ambiguous } = analyze(METHODS);
    expect(steps).toEqual({ 'Box>static make': ['Step 1: build one'], 'Box>make': ['Step 1: build another'] });
    expect(ambiguous).toEqual([]);
    expect(checkAgainstLock(P, METHODS, lockOf(METHODS), plan)).toEqual([]);
  });

  test('a static getter and an instance getter are told apart too', () => {
    const src = `export class Box {\n  static get id(): number ${body(1, 'a')}\n  get id(): number ${body(1, 'b')}\n}`;
    const { steps, ambiguous } = analyze(src);
    expect(Object.keys(steps)).toEqual(['Box>static get id', 'Box>get id']);
    expect(ambiguous).toEqual([]);
  });

  test('properties that hold arrows: static and instance have their own names', () => {
    const src = [
      'export class Box {',
      '  static run = (): void => {\n    // Step 1: static one\n  };',
      '  run = (): void => {\n    // Step 1: instance one\n  };',
      '}',
    ].join('\n');
    const { steps, ambiguous } = analyze(src);
    expect(Object.keys(steps)).toEqual(['Box>static run', 'Box>run']);
    expect(ambiguous).toEqual([]);
  });

  test('a marker moved between the static method and the instance one is caught', () => {
    const swapped = METHODS.replace('build one', 'TMP').replace('build another', 'build one').replace('TMP', 'build another');
    expect(checkAgainstLock(P, swapped, lockOf(METHODS), plan)).toEqual(
      ['step 1 in Box>static make was changed or removed', 'step 1 in Box>make was changed or removed'],
    );
  });

  test('the fingerprint of a class with only plain methods is unchanged: their names have no prefix', () => {
    expect(fingerprintCode('f.ts', `export class Box {\n  open(): void ${body(1, 'go')}\n}`).steps).toEqual({ 'Box>open': ['Step 1: go'] });
  });
});
