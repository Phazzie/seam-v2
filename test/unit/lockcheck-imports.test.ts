// Review fix: an import can't walk out of the package the plan allows, and wrapped exports keep
// their bodies out of the signature.
import { describe, expect, test } from 'vitest';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { HEADER_END, check, edit, lockFor, plan } from '../helpers/lockcheck.ts';

/** The file with an import of `spec`; a backslash is written as the two characters a string needs, so the import really has one. */
const withImport = (spec: string): string => edit(HEADER_END, `${HEADER_END}import x from '${spec.replaceAll('\\', '\\\\')}';\n`);
const refused = (spec: string): string[] => [`import of '${spec}' isn't in the plan`];

describe('an import can not leave the package the plan names', () => {
  test.each([
    'react/../lodash',
    'react/../../src/secret',
    'react/../../../etc/passwd',
    'react/./jsx-runtime',
    'react//jsx-runtime',
    'react/',
    '@scope/../lodash',
    'react/%2e%2e/lodash',
    'react/..%2flodash',
  ])('%s', (spec) => expect(check(withImport(spec))).toEqual(refused(spec)));

  test.each([
    String.raw`react\..\lodash`,
    String.raw`react\jsx-runtime`,
    String.raw`.\secret`,
    String.raw`..\greeting\Greeting`,
    String.raw`./..\..\src\secret`,
  ])('a backslash: %s', (spec) => expect(check(withImport(spec))).toEqual(refused(spec)));

  test.each([
    '../greeting/../../secret',
    '../../secret',
    '../../../outside',
    './../../src/secret',
    '..',
    '.',
    '../greeting/Greeting?x=1',
    '../greeting/Greeting#x',
  ])('a relative path that does not end at a planned file: %s', (spec) => expect(check(withImport(spec))).toEqual(refused(spec)));

  test.each([
    'react', 'react/jsx-runtime', '../greeting/Greeting', '../greeting/../greeting/Greeting.tsx', './../greeting/Greeting.js',
  ])('still fine: %s', (spec) => expect(check(withImport(spec))).toEqual([]));

  test('a plan that lists a deep path allows that path', () => {
    const deep = { ...plan, packages: ['react', 'lodash/fp'] };
    expect(check(withImport('lodash/fp'), undefined, deep)).toEqual([]);
    expect(check(withImport('lodash/fp/../x'), undefined, deep)).toEqual(refused('lodash/fp/../x'));
  });
});

describe('wrapped exports keep their bodies out of the signature', () => {
  const PATH = 'src/ui/Thing.tsx';
  const HEAD = '/**\n * @seam ui\n */\nimport { memo, forwardRef } from \'react\';\n\n';
  const against = (locked: string, proposed: string): string[] => checkAgainstLock(PATH, HEAD + proposed, lockFor(PATH, HEAD + locked), plan);
  const filled = (locked: string, proposed: string): void => expect(against(locked, proposed)).toEqual([]);
  const changed = (locked: string, proposed: string, name: string): void => expect(against(locked, proposed)).toEqual([`export ${name}'s signature changed`]);

  test('memo around an arrow', () => {
    filled("export const C = memo((p: { n: number }) => { throw new Error('x'); });", 'export const C = memo((p: { n: number }) => { return null; });');
    filled("export const C = memo((p: { n: number }) => { throw new Error('x'); });", 'export const C = memo((p: { n: number }) => null);');
    changed("export const C = memo((p: { n: number }) => { throw new Error('x'); });", 'export const C = memo((p: { n: string }) => null);', 'C');
  });
  test('forwardRef around a function', () => {
    const locked = "export const R = forwardRef(function R(p: { n: number }, ref: unknown) { throw new Error('x'); });";
    filled(locked, 'export const R = forwardRef(function R(p: { n: number }, ref: unknown) { return null; });');
    changed(locked, 'export const R = forwardRef(function R(p: { n: string }, ref: unknown) { return null; });', 'R');
  });
  test('memo around forwardRef', () => {
    filled("export const M = memo(forwardRef((p: { n: number }, ref: unknown) => { throw new Error('x'); }));",
      'export const M = memo(forwardRef((p: { n: number }, ref: unknown) => { return null; }));');
  });
  test('an object with methods', () => {
    const locked = "export const api = { run(a: number): number { throw new Error('x'); }, get size(): number { throw new Error('x'); }, go: (b: number) => { throw new Error('x'); } };";
    filled(locked, 'export const api = { run(a: number): number { return a; }, get size(): number { return 1; }, go: (b: number) => b };');
    changed(locked, 'export const api = { run(a: string): number { return 1; }, get size(): number { return 1; }, go: (b: number) => b };', 'api');
    changed(locked, 'export const api = { run(a: number): number { return a; }, get size(): number { return 1; }, go: (b: number) => b, extra: 1 };', 'api');
  });
  test('parentheses, as, satisfies and a non-null mark', () => {
    for (const wrap of ['((a: number) => { throw new Error("x"); })', '((a: number) => { throw new Error("x"); }) as Fn', '((a: number) => { throw new Error("x"); }) satisfies Fn']) {
      const body = wrap.replace('throw new Error("x");', 'return a;');
      filled(`export const f = ${wrap};`, `export const f = ${body};`);
    }
    changed('export const f = ((a: number) => { throw new Error("x"); }) as Fn;', 'export const f = ((a: string) => { return 1; }) as Fn;', 'f');
    changed('export const f = ((a: number) => { throw new Error("x"); }) as Fn;', 'export const f = ((a: number) => { return 1; }) as Gn;', 'f');
  });
  test('a class expression and a class with property arrows', () => {
    filled("export const K = class { m(a: number) { throw new Error('x'); } };", 'export const K = class { m(a: number) { return a; } };');
    filled("export class Z { h = (a: number) => { throw new Error('x'); }; m(a: number) { throw new Error('x'); } }", 'export class Z { h = (a: number) => a; m(a: number) { return a; } }');
  });
  test('an exported value that points at a private function carries that function\'s signature', () => {
    const locked = "function work(a: number): number { throw new Error('x'); }\nexport const run = work;\nexport default { work };";
    filled(locked, 'function work(a: number): number { return a; }\nexport const run = work;\nexport default { work };');
    expect(against(locked, 'function work(a: string): number { return 1; }\nexport const run = work;\nexport default { work };'))
      .toEqual(["export default's signature changed", "export run's signature changed"]);
  });
});
