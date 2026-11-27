// R35: a signature can't change meaning while its words stay the same.
import { describe, expect, test } from 'vitest';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { total } from '../helpers/code.ts';
import { check, lockOf } from '../helpers/lockcheck.ts';

const builtIn = (name: string): string => `'${name}' is the name of a type TypeScript provides, so it can't be declared here`;
const IMPORT = "import type { Money } from './money';";
/** total.ts with `top` above the function and `params` in its signature, and the lock made from it. */
const made = (top: string[], params: string): { text: string; against: ReturnType<typeof lockOf> } => {
  const text = total({ top, params });
  return { text, against: lockOf(text) };
};

describe('what an import stands for is fixed', () => {
  const { text, against } = made([IMPORT], 'a: Money, b: Money');
  const test_ = (name: string, bent: string, expected: string[]): void => test(name, () => expect(check(bent, against)).toEqual(expected));

  test('the file as it is', () => expect(check(text, against)).toEqual([]));
  test_('Money turned into another type under the same name', text.replace('{ Money }', '{ Cents as Money }'), ['import Money was changed or removed']);
  test_('a type import turned into a value import', text.replace('import type', 'import'), ['import Money was changed or removed']);
  test_('another way to say it is a type import is not a change', text.replace('import type { Money }', 'import { type Money }'), []);
  test_('the same name from a default import', text.replace('{ Money }', 'Money'), ['import Money was changed or removed']);
  test_('the same name from a namespace import', text.replace('{ Money }', '* as Money'), ['import Money was changed or removed']);
  test_('the import taken out and a type of the same name written instead', text.replace(IMPORT, 'type Money = string;'),
    ['import Money was changed or removed', "the planned import of './money' was removed"]);
  test_('quotes and spacing are not a change', text.replace(IMPORT, 'import type {Money} from "./money";'), []);
  test_('another name added from the same module', text.replace(IMPORT, "import type { Money, Extra } from './money';"), []);
  test_('a name given its own name again, in a new import', text.replace(IMPORT, "import type { Money as Money } from './money';"), []);

  test('what an import stands for is in the lock, name by name', () => {
    const { fixed } = fingerprintCode('a.ts', "import type { Money as M } from './m';\nimport D, * as N from 'x';\nimport { type T, V } from 'y';");
    expect(Object.keys(fixed).sort()).toEqual(['import D', 'import M', 'import N', 'import T', 'import V']);
    expect(fixed['import M']).not.toBe(fingerprintCode('a.ts', "import type { Cents as M } from './m';").fixed['import M']);
  });
});

describe('a constant a signature points at is fixed', () => {
  const { text, against } = made(['const RATE = 0.2;', 'const LIMITS = { max: 10, label: "x" };'], 'a: typeof RATE, b: typeof LIMITS');
  test('the file as it is', () => expect(check(text, against)).toEqual([]));
  test('RATE changed', () => expect(check(text.replace('0.2', '0.3'), against)).toEqual(['const RATE was changed or removed']));
  test('RATE made a let', () => expect(check(text.replace('const RATE', 'let RATE'), against)).toEqual(['const RATE was changed or removed']));
  test('a value inside an object changed', () => expect(check(text.replace('max: 10', 'max: 11'), against)).toEqual(['const LIMITS was changed or removed']));
  test('RATE taken out', () => expect(check(text.replace('const RATE = 0.2;\n', ''), against)).toEqual(['const RATE was changed or removed']));
  test('a new constant is fine', () => expect(check(`${text}const OTHER = 1;\n`, against)).toEqual([]));
  test('an exported constant that changes is reported once, as an export', () => {
    const exported = made(['export const RATE = 0.2;'], 'a: typeof RATE, b: number');
    expect(check(exported.text.replace('0.2', '0.3'), exported.against)).toEqual(["export RATE's signature changed"]);
  });
  test('a function kept in a constant keeps its signature, but its body is free', () => {
    const fn = made(['const k = (a: number): number => { throw new Error("x"); };'], 'a: number, b: number');
    expect(check(fn.text.replace('throw new Error("x");', 'return a * 2;'), fn.against)).toEqual([]);
    expect(check(fn.text.replace('(a: number)', '(a: string)'), fn.against)).toEqual(['const k was changed or removed']);
  });
});

describe('a class a signature points at is fixed', () => {
  const { text, against } = made(['class Box { x: number = 1; static kind = "box"; m(a: number): number { throw new Error("x"); } }'], 'a: Box, b: Box');
  test('the file as it is', () => expect(check(text, against)).toEqual([]));
  test('a field type changed', () => expect(check(text.replace('x: number', 'x: string'), against)).toEqual(['class Box was changed or removed']));
  test('a field added', () => expect(check(text.replace('static kind', 'y = 2; static kind'), against)).toEqual(['class Box was changed or removed']));
  test('a method signature changed', () => expect(check(text.replace('m(a: number)', 'm(a: string)'), against)).toEqual(['class Box was changed or removed']));
  test('a static value changed', () => expect(check(text.replace('"box"', '"crate"'), against)).toEqual(['class Box was changed or removed']));
  test('a method body is free', () => expect(check(text.replace('throw new Error("x");', 'return a;'), against)).toEqual([]));
  test('a new class is fine', () => expect(check(`${text}class Other {}\n`, against)).toEqual([]));
});

describe('a type can not take the name of one TypeScript provides', () => {
  const withTop = (code: string): string => `${total()}\n${code}\n`;
  test.each([
    ['type Promise<T> = string;', 'Promise'],
    ['type Record<K, V> = number;', 'Record'],
    ['type Partial<T> = T;', 'Partial'],
    ['interface Date { x: 1 }', 'Date'],
    ['interface Array<T> { x: 1 }', 'Array'],
    ['class Map {}', 'Map'],
    ['class Set {}', 'Set'],
    ['class Error {}', 'Error'],
    ['enum Event { A }', 'Event'],
    ['declare class URL {}', 'URL'],
    ["import type { Date } from 'react';", 'Date'],
    ["import { Response } from 'react';", 'Response'],
    ["import * as Request from 'react';", 'Request'],
    ["import Node from 'react';", 'Node'],
  ])('%s', (code, name) => expect(check(withTop(code))).toEqual([builtIn(name)]));

  test('names that only look alike are fine', () =>
    expect(check(withTop('type Dates = 1;\ninterface MyDate {}\nclass MapOf {}\nenum Errors { A }'))).toEqual([]));
  test('a value with that name is not a type', () => expect(check(withTop('const Date = 1;'))).toEqual([]));
  test('two of them are both named', () => expect(check(withTop('type Promise = 1;\ninterface Date {}'))).toEqual([builtIn('Date'), builtIn('Promise')]));
});
