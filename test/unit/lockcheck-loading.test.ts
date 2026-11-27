// R34: top-level code must not run anything at load. Each bypass is refused; each honest form is fine.
import { describe, expect, test } from 'vitest';
import { FILLED, check } from '../helpers/lockcheck.ts';

const NOT_ALLOWED = "a statement outside any function isn't allowed";
const withTop = (...lines: string[]): string => `${FILLED}\n${lines.join('\n')}\n`;
/** An object whose valueOf, toString and getter all patch an export when something touches them. */
const TRAP = "const o = { valueOf() { total = () => 0; return 1; }, toString() { total = () => 0; return 'x'; } };";

describe('operators, templates and property reads that would run a valueOf, toString or getter', () => {
  test.each<[string, string]>([
    ['an operator on a name', `${TRAP}\nconst n = o + 1;`],
    ['a comparison with a name', `${TRAP}\nconst b = o < 1;`],
    ['a template with a name in it', `${TRAP}\nconst s = \`\${o}\`;`],
    ['a minus on a name', `${TRAP}\nconst n = -o;`],
    ['a plus on a name', `${TRAP}\nconst n = +o;`],
    ['a tilde on a name', `${TRAP}\nconst n = ~o;`],
    ['a not on a name', `${TRAP}\nconst n = !o;`],
    ['typeof', 'const t = typeof o;'],
    ['an operator between a literal and a name', 'const n = 1 + o;'],
    ['a name inside a bigger sum', 'const n = 1 + 2 * (3 + o);'],
    ['a conditional on literals', 'const x = true ? 1 : 2;'],
    ['a property read', 'const x = o.x;'],
    ['a property read of a property read', 'const x = a.b.c;'],
    ['a method call on a literal', "const x = 'a'.toUpperCase();"],
    ['destructuring an object', 'const { x } = o;'],
    ['destructuring an array', 'const [x] = o;'],
    ['destructuring in a let', 'let { x } = o;'],
    ['a getter in an object', 'const c = { get v() { return 1; } };'],
    ['a setter in an object', 'const c = { set v(x) {} };'],
    ['a name read through an index', "const x = o['x'];"],
    ['export default of a sum with a name', 'export default o + 1;'],
    ['a static value with an operator on a name', 'class C { static v = o * 2; }'],
    ['a static value that reads a property', 'class C { static v = o.x; }'],
    ['an enum value with an operator on an outside name', 'enum E { A = o + 1 }'],
    ['an enum value that is an outside name', 'enum E { A = o }'],
    ['an enum value that reads a property of another object', 'enum E { A = o.x }'],
    ['an enum value that is a call', 'enum E { A = f() }'],
    ['a string enum value built from a name', 'enum E { A = `${o}` }'],
  ])('%s', (_name, code) => expect(check(withTop(code))).toContain(NOT_ALLOWED));
});

describe('memo and forwardRef only count when they are the ones from react', () => {
  test.each<[string, string]>([
    ['a function of the same name written in the file', 'function memo(f) { total = () => 0; return f; }\nconst C = memo(() => 1);'],
    ['a constant of the same name written in the file', 'const memo = (f) => f;\nconst C = memo(() => 1);'],
    ['a property of a name', "import R from 'react';\nconst C = R.memo(() => 1);"],
    ['a property of the namespace import', "import * as R from 'react';\nconst C = R.forwardRef(() => 1);"],
    ['a name of that sort from another package', "import { memo } from 'evil';\nconst C = memo(() => 1);"],
    ['a type-only import', "import type { memo } from 'react';\nconst C = memo(() => 1);"],
    ['a type-only name inside an import', "import { type memo } from 'react';\nconst C = memo(() => 1);"],
    ['another name from react', "import { useMemo } from 'react';\nconst C = useMemo(() => 1);"],
    ['memo given something that is not a value', "import { memo } from 'react';\nconst C = memo(init());"],
    ['memo with a property read inside', "import { memo } from 'react';\nconst C = memo(o.x);"],
  ])('%s', (_name, code) => expect(check(withTop(code))).toContain(NOT_ALLOWED));
});

describe('classes extend a plain name and keep their static values simple', () => {
  test.each<[string, string]>([
    ['extends a property', 'class C extends A.B {}'],
    ['extends a call', 'class C extends f(A) {}'],
    ['extends a property in a class declared with export', 'export class C extends A.B {}'],
  ])('%s', (_name, code) => expect(check(withTop(code))).toContain(NOT_ALLOWED));
});

describe('the honest forms are fine', () => {
  test.each<[string, string]>([
    ['an enum built from literals, shifts and its own members', 'enum F { A = 1 << 0, B = A | 1 }'],
    ['an enum naming its members by the enum', 'enum G { A = 1, B = G.A * 2, C = -A, D = ~G.B }'],
    ['an enum of strings', "enum S { A = 'a', B = `b` }"],
    ['memo from react', "import { memo } from 'react';\nconst C = memo((p: { n: number }) => null);"],
    ['forwardRef from react', "import { forwardRef } from 'react';\nconst R = forwardRef(function R(p, ref) { return null; });"],
    ['memo and forwardRef together, one of them renamed', "import { memo as m, forwardRef } from 'react';\nconst M = m(forwardRef((p, ref) => null));"],
    ['literals and operators between literals', "const a = 'a' + 'b', b = -1, c = ~0, d = 2 ** 8, e = 1 << 4 | 1;"],
    ['as const and satisfies', 'const k = [1, 2] as const;\nconst o = { a: 1 } satisfies object;'],
    ['a class with an extends name, static literals and static functions', 'class Box extends Base { static v = 2 * 2; static f = () => 1; static o = { a: [1] }; x = init(); }'],
    ['objects and arrays of values, with methods', 'const cfg = { a: [1, { b: () => 1 }], m() { return 1; }, s };'],
  ])('%s', (_name, code) => expect(check(withTop(code))).toEqual([]));

  test('memo from react as an export of a planned file', () => {
    const text = `${FILLED}import { memo } from 'react';\nconst C = memo(() => null);\n`;
    expect(check(text)).toEqual([]);
  });
});
