// An export that goes through a local name carries the signature of what that name stands for, all the way
// down: `function work(a: number)` exported as `export { work as total }`, or through `const alias = work`.
import { describe, expect, test } from 'vitest';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { P, lockOf, plan } from '../helpers/lockcheck.ts';

/** The shapes an export can take on its way to `work`; each is written with `sig` as work's parameter list and `body` as its code. */
const SHAPES: Record<string, (sig: string, body?: string) => { src: string; name: string }> = {
  'a renamed export of the function': (sig, body = 'return 1;') => ({ src: `function work(${sig}): number { ${body} }\nexport { work as total };`, name: 'total' }),
  'a plain export of the function by name': (sig, body = 'return 1;') => ({ src: `function work(${sig}): number { ${body} }\nexport { work };`, name: 'work' }),
  'a renamed default export of the function': (sig, body = 'return 1;') => ({ src: `function work(${sig}): number { ${body} }\nexport { work as default };`, name: 'default' }),
  'an alias constant, exported renamed': (sig, body = 'return 1;') => ({ src: `function work(${sig}): number { ${body} }\nconst alias = work;\nexport { alias as total };`, name: 'total' }),
  'a chain of alias constants': (sig, body = 'return 1;') => ({ src: `function work(${sig}): number { ${body} }\nconst a1 = work;\nconst a2 = a1;\nexport { a2 as total };`, name: 'total' }),
  'an object that holds it': (sig, body = 'return 1;') => ({ src: `function work(${sig}): number { ${body} }\nconst api = { work };\nexport { api as total };`, name: 'total' }),
  'an alias constant, exported as the default': (sig, body = 'return 1;') => ({ src: `function work(${sig}): number { ${body} }\nconst alias = work;\nexport default alias;`, name: 'default' }),
  'an exported constant built from an alias': (sig, body = 'return 1;') => ({ src: `function work(${sig}): number { ${body} }\nconst a1 = work;\nexport const total = a1;`, name: 'total' }),
  'an arrow function, exported renamed': (sig, body = '1') => ({ src: `const work = (${sig}): number => ${body};\nexport { work as total };`, name: 'total' }),
};

describe.each(Object.entries(SHAPES))('%s', (_label, shape) => {
  test('changing the signature of the function is caught, by name', () => {
    const { src, name } = shape('a: number');
    const changed = shape('a: string').src;
    // A local constant that holds it is a fixed item as well, and is reported on its own line; the export is reported either way.
    expect(checkAgainstLock(P, changed, lockOf(src), plan)).toContain(`export ${name}'s signature changed`);
  });

  test('changing the code inside it, or a function nothing exported uses, is not a change', () => {
    const { src } = shape('a: number');
    const body = shape('a: number', src.includes('=>') ? '2 + 2' : 'return 2 + 2;').src;
    expect(checkAgainstLock(P, body, lockOf(src), plan)).toEqual([]);
    expect(checkAgainstLock(P, `${src}\nfunction other(x: string): string { return x; }\n`, lockOf(src), plan)).toEqual([]);
  });
});

describe('edge cases', () => {
  test('the example: a locked function exported under another name', () => {
    const locked = 'function work(a: number): number { throw new Error("x"); }\nexport { work as total };';
    expect(checkAgainstLock(P, 'function work(a: number): number { return a; }\nexport { work as total };', lockOf(locked), plan)).toEqual([]);
    expect(checkAgainstLock(P, 'function work(a: number, b: number): number { return a; }\nexport { work as total };', lockOf(locked), plan))
      .toEqual(["export total's signature changed"]);
  });

  test('names that point at each other do not loop, and still give a stable hash', () => {
    const src = 'const a = b;\nconst b = a;\nexport { a };';
    expect(fingerprintCode('f.ts', src).exports.a).toBe(fingerprintCode('f.ts', src).exports.a);
  });

  test('an export that points at a name that is not declared in the file is still marked unresolved, as before', () => {
    expect(fingerprintCode('f.ts', 'export { nowhere };').exports.nowhere).toBe(fingerprintCode('f.ts', 'export { nowhere };').exports.nowhere);
    expect(fingerprintCode('f.ts', 'export { nowhere };').exports.nowhere).not.toBe(fingerprintCode('f.ts', 'export { elsewhere as nowhere };').exports.nowhere);
  });

  test('an alias that is exported under its own name has the same hash as the same alias declared exported', () => {
    const viaClause = fingerprintCode('f.ts', 'function work(a: number): number { return a; }\nconst total = work;\nexport { total };').exports.total;
    const declared = fingerprintCode('f.ts', 'function work(a: number): number { return a; }\nexport const total = work;').exports.total;
    expect(viaClause).toBe(declared);
  });
});
