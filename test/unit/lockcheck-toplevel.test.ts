// Review fix R31: nothing outside a function may run code when the file loads.
import { describe, expect, test } from 'vitest';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { FILLED, HEADER_END, check, edit, lockFor, plan } from '../helpers/lockcheck.ts';

const NOT_ALLOWED = "a statement outside any function isn't allowed";
const withTop = (...lines: string[]): string => `${FILLED}\n${lines.join('\n')}\n`;

describe('code that runs while the file loads is refused', () => {
  test.each<[string, string]>([
    ['assigning over an export', 'total = () => 0;'],
    ['changing a value', 'const RATE = { v: 1 };\nRATE.v = 0.9;'],
    ['Object.defineProperty', "const RATE = { v: 1 };\nObject.defineProperty(RATE, 'v', { value: 0.9 });"],
    ['a function called at once patching Math.round', '(() => { Math.round = () => 0; })();'],
    ['a plain call', 'init();'],
    ['an if', 'if (flag) { init(); }'],
    ['a loop', 'for (;;) { break; }'],
    ['try / catch', 'try { init(); } catch (e) { throw e; }'],
    ['a label', 'out: for (;;) { break out; }'],
    ['a bare block', '{ init(); }'],
    ['the result of a call', 'const x = init();'],
    ['a call that only takes a function (it is run at once)', 'const x = [1].map(() => 1);'],
    ['forEach with a function that patches an export', '[1].forEach(() => { total = () => 0; });'],
    ['new', 'const m = new Map();'],
    ['a computed key that runs code', 'const o = { [Math.round = f]: 1 };'],
    ['a spread', 'const o = { ...other };'],
    ['a default value that runs code', 'const { a = init() } = o;'],
    ['top-level await', 'await init();'],
    ['a class static block', 'class A { static { init(); } }'],
    ['a class static value that runs code', 'class A { static x = init(); }'],
    ['a class computed name that runs code', 'class A { [init()]() {} }'],
    ['a class that extends an expression', 'class A extends mixin(Base) {}'],
    ['a decorator', '@dec class A {}'],
    ['a namespace with code in it', 'namespace N { init(); }'],
    ['an enum value that runs code', 'enum E { A = init() }'],
    ['export default of a call', 'export default init();'],
    ['using', 'using r = init();'],
    ['a conditional', 'const x = a ? b : c;'],
    ['a template that calls', 'const x = `a${init()}b`;'],
    ['an increment', 'let n = 0;\nn++;'],
    ['a call on a built-in', "console.log('loaded');"],
  ])('%s', (_name, code) => expect(check(withTop(code), undefined, plan)).toContain(NOT_ALLOWED));

  test('the message is given once, however many statements there are', () =>
    expect(check(withTop('init();', 'init();')).filter((p) => p === NOT_ALLOWED)).toHaveLength(1));
});

describe('declarations that only define things are fine', () => {
  test.each<[string, string]>([
    ['a constant', 'const K = 1;'],
    ['a let with no value', 'let counter;'],
    ['var', "var legacy = 'x';"],
    ['literals of every kind', "const a = 1, b = 'x', c = -1, d = null, e = /x/g, f = `t`, g = undefined, h = true, i = 10n;"],
    ['arithmetic on literals', 'const T = 60 * 60 + 1;\nconst S = `a${T}b`;\nconst U = !T && T > 0;'],
    ['an object of literals, functions and methods', "const cfg = { a: 1, b: [1, 2, { c: 'x' }], f() { return 1; }, g: () => 2, get h() { return 3; }, 'k-q': -1, ['lit']: 2, short };"],
    ['wrapped in as, satisfies and parentheses', "const w = ({ a: 1 } as const) satisfies object;"],
    ['a function kept in a name', 'const fn = (a: number) => a;\nconst fe = function () { return 1; };'],
    ['memo and forwardRef', 'const C = memo((p: { n: number }) => null);\nconst R = React.forwardRef(function R(props, ref) { return null; });'],
    ['a pattern with no defaults', 'const { a, b: [c] } = other;'],
    ['a class with methods, an extends name and an instance value that calls', "class Box extends React.Component { static kind = 'box'; x = init(); m() { return 1; } }"],
    ['an enum with literal values', "enum Kind { A = 1, B = 'b', C = 1 + 2 }"],
    ['types and interfaces', 'type T = string;\ninterface I { a: T }'],
    ['ambient declarations', "declare const g: number;\ndeclare function gg(): void;\ndeclare module 'x' { export const y: number; }\ndeclare global { interface Window { w: 1 } }"],
    ['function overloads', 'function o(a: string): void;\nfunction o(a: number): void;\nfunction o(a: unknown) {}'],
    ['a stray semicolon and an empty export', ';\nexport {};'],
    ['an import', "import { useMemo } from 'react';"],
  ])('%s', (_name, code) => expect(check(withTop(code), undefined, plan)).toEqual([]));

  test('a directive after the header', () => expect(check(edit(HEADER_END, `${HEADER_END}'use client';\n`))).toEqual([]));
});

describe('a name declared twice', () => {
  const twice = (code: string, name: string): void => expect(check(withTop(code))).toEqual([`'${name}' is declared more than once`]);
  test('two functions', () => twice('function h() {}\nfunction h() {}', 'h'));
  test('a constant and a function', () => twice('const h = 1;\nfunction h() {}', 'h'));
  test('a second function with the name of an export', () => {
    expect(check(withTop('function total() { return 0; }'))).toContain("'total' is declared more than once");
  });
  test('a namespace merged onto an exported name', () => {
    expect(check(withTop('declare namespace total { const x: number; }'))).toContain("'total' is declared more than once");
  });
  test('an import and a local of the same name', () => twice("import { h } from 'react';\nconst h = 1;", 'h'));
  test('a class and an interface (they would merge)', () => twice('class K {}\ninterface K { a: 1 }', 'K'));
  test('a type and a value with the same name are different things', () =>
    expect(check(withTop('type X = 1;\nconst X = 1;'))).toEqual([]));
});

describe('a CommonJS file', () => {
  const CJS = 'src/pricing/total.cjs';
  const HEAD = '/**\n * @seam pricing\n */\n';
  const SKELETON = `${HEAD}function total(a, b) {\n  // Step 1: first\n  throw new Error('Not built yet');\n}\nmodule.exports = { total };\n`;
  const lock = lockFor(CJS, SKELETON);
  const cjs = (text: string): string[] => checkAgainstLock(CJS, text, lock, plan);

  test('the body filled in is fine', () => expect(cjs(SKELETON.replace("throw new Error('Not built yet');", 'return a + b;'))).toEqual([]));
  test('a second function with the same name', () => {
    expect(cjs(`${SKELETON}function total() { return 0; }\n`)).toContain("'total' is declared more than once");
  });
  test('Object.defineProperty(exports, ...)', () => {
    expect(cjs(`${SKELETON}Object.defineProperty(exports, 'total', { value: () => 0 });\n`)).toContain(NOT_ALLOWED);
  });
  test('assigning over the function', () => expect(cjs(`${SKELETON}total = () => 0;\n`)).toContain(NOT_ALLOWED));
  test('a second export is a new export', () => {
    const problems = cjs(`${SKELETON}exports.extra = () => 1;\n`);
    expect(problems).toEqual(["new export 'exports.extra' isn't in the plan"]);
  });
  test('an export that runs code', () => expect(cjs(`${SKELETON}exports.extra = init();\n`)).toContain(NOT_ALLOWED));
  test('the signature of an exported function can not change', () => {
    expect(cjs(SKELETON.replace('total(a, b)', 'total(a)'))).toEqual(["export module.exports's signature changed"]);
  });
  test('a private helper is fine', () => {
    expect(cjs(`${SKELETON}\nfunction extra(q) { return q; }\n`)).toEqual([]);
  });
});
