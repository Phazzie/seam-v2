// R78 (Codex on PR #23): what an exported arrow function is made of is found by the names its signature mentions, and that included
// the names its own parameters declare: `(helper: number) => ...` was taken to depend on a local function `helper`, so changing that
// function's signature changed the export's hash, a false change in a file the builder had not touched. A name the function binds for
// itself (a parameter, a destructured one, a type parameter, a function expression's own name) is not a mention of anything outside it.
import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { mentions } from '../../src/lib/mentions.ts';

const exportHash = (src: string, name = 'total'): string | undefined => fingerprintCode('src/a.ts', src).exports[name];
const expression = (text: string): ts.Expression => {
  const sf = ts.createSourceFile('x.ts', `const x = ${text};`, ts.ScriptTarget.Latest, true);
  const [stmt] = sf.statements;
  if (!ts.isVariableStatement(stmt) || stmt.declarationList.declarations[0].initializer === undefined) throw new Error('Test setup: not an expression.');
  return stmt.declarationList.declarations[0].initializer;
};

describe('mentions: what an expression refers to outside itself', () => {
  test.each([
    ['(a: number) => a + 1', []],
    ['(helper: number, b = helper) => 1', []],
    ['({ helper, other: { deep } }: Opts) => 1', ['Opts']],
    ['([first, ...rest]: Items) => 1', ['Items']],
    ['(n: Options) => 1', ['Options']],
    ['(n: number = LIMIT) => 1', ['LIMIT']],
    ['(n: typeof helper) => 1', ['helper']],
    ['<T>(x: T): T => x', []],
    ['<T extends Base>(x: T): Result<T> => x', ['Base', 'Result']],
    ['function helper(a: number): number { return a; }', []],
    ['(cb = (helper: number) => helper) => 1', []],
    ['memo((props: Props) => null)', ['memo', 'Props']],
    ['{ run: (helper: number) => 1, other }', ['other']],
    ['{ helper: 1 }', []],
    ['a.helper', ['a']],
    ['(x: { helper: number }) => 1', []],
    ['(x: NS.Inner) => 1', ['NS']],
    ['(x: helper) => 1', ['helper']],
    ['(helper: helper) => 1', ['helper']],
  ])('%s', (text, expected) => {
    expect(mentions(expression(text)).sort()).toEqual([...expected].sort());
  });
});

describe('an export clause or an exported constant whose function has a parameter named like a local', () => {
  const helper = (sig: string) => `function helper(x: ${sig}): void {}\n`;
  const SHAPES: Record<string, (rest: string) => string> = {
    'an arrow function exported with an export clause': (rest) => `${rest}const total = (helper: number, b: number): number => helper + b;\nexport { total };`,
    'an arrow function exported directly': (rest) => `${rest}export const total = (helper: number, b: number): number => helper + b;`,
    'a destructured parameter': (rest) => `${rest}const total = ({ helper }: { helper: number }): number => helper;\nexport { total };`,
    'a function expression named like it': (rest) => `${rest}const total = function helper(a: number): number { return a; };\nexport { total };`,
    'a nested arrow function in a default value': (rest) => `${rest}const total = (cb = (helper: number) => helper): number => 1;\nexport { total };`,
    'as the default export': (rest) => `${rest}const total = (helper: number): number => helper;\nexport default total;`,
  };

  test.each(Object.entries(SHAPES))('%s: changing the local function\'s own signature is not a change to the export', (_label, shape) => {
    const name = shape('').includes('export default') ? 'default' : 'total';
    expect(exportHash(shape(helper('number')), name)).toBeDefined();
    expect(exportHash(shape(helper('string')), name)).toBe(exportHash(shape(helper('number')), name));
  });

  test('a type parameter named like a local type is not that type either', () => {
    const src = (alias: string) => `type T = ${alias};\nconst total = <T>(x: T): T => x;\nexport { total };`;
    expect(exportHash(src('string'))).toBe(exportHash(src('number')));
  });
});

describe('what a signature really refers to still counts', () => {
  const clause = (decl: string, sig: string) => `${decl}\nconst total = (${sig}): number => 1;\nexport { total };`;

  test('a local type used as a parameter type', () => {
    expect(exportHash(clause('interface Options { a: number }', 'n: Options'))).not.toBe(exportHash(clause('interface Options { a: string }', 'n: Options')));
  });
  test('a local constant used as a default value', () => {
    expect(exportHash(clause('const LIMIT = 10;', 'n = LIMIT'))).not.toBe(exportHash(clause('const LIMIT = 20;', 'n = LIMIT')));
  });
  test('a local function named in `typeof` in a parameter type', () => {
    expect(exportHash(clause('function helper(x: number): void {}', 'n: typeof helper'))).not.toBe(exportHash(clause('function helper(x: string): void {}', 'n: typeof helper')));
  });
  test('a parameter that shares its name with a local TYPE does not hide that type when the type is used', () => {
    expect(exportHash(clause('interface helper { a: number }', 'helper: helper'))).not.toBe(exportHash(clause('interface helper { a: string }', 'helper: helper')));
  });
  test('a local used in the signature of the arrow, next to a parameter of the same name as another local', () => {
    const src = (limit: number) => `const LIMIT = ${limit};\nfunction helper(x: number): void {}\nconst total = (helper: number, n = LIMIT): number => 1;\nexport { total };`;
    expect(exportHash(src(10))).not.toBe(exportHash(src(20)));
  });
});
