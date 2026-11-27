// R38: a new type or import can't take a name a locked signature uses as a type.
import { describe, expect, test } from 'vitest';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { parseSource } from '../../src/lib/codeprint.ts';
import { collectTypeRefs } from '../../src/lib/typerefs.ts';
import { total } from '../helpers/code.ts';
import { check, lockOf, plan } from '../helpers/lockcheck.ts';

const used = (name: string): string => `'${name}' is used by a locked signature, so a new declaration of it isn't allowed`;
/** The plan with the packages these tests import from. */
const withPackages = { ...plan, packages: [...plan.packages, 'immutable', 'express'] };
const SIGNATURE = 'r: Response, m: Map<string, number>, e: Event';
const text = total({ params: SIGNATURE });
const lock = lockOf(text);
const bent = (extra: string): string[] => check(`${text}${extra}\n`, lock, withPackages);

describe('a new declaration can not take a name a locked signature uses as a type', () => {
  test('the file as it is', () => expect(bent('')).toEqual([]));
  test('a new interface', () => expect(bent('interface Response {}')).toEqual([used('Response')]));
  test('a new class', () => expect(bent('class Event {}')).toEqual([used('Event')]));
  test('a new import', () => expect(bent("import { Map } from 'immutable';")).toEqual([used('Map')]));
  test('a new import that the plan does not list is refused for that too', () =>
    expect(check(`${text}import { Map } from 'immutable';\n`, lock)).toEqual([used('Map'), "import of 'immutable' isn't in the plan"]));
  test('a new type alias', () => expect(bent('type Response = string;')).toEqual([used('Response')]));
  test('a new enum', () => expect(bent('enum Event { A }')).toEqual([used('Event')]));
  test('a new default import and a new namespace import', () => {
    expect(bent("import Response from 'immutable';")).toEqual([used('Response')]);
    expect(bent("import * as Event from 'immutable';")).toEqual([used('Event')]);
  });
  test('an import renamed to the name', () => expect(bent("import { Other as Map } from 'immutable';")).toEqual([used('Map')]));
  test('several at once are each named', () => expect(bent('interface Response {}\nclass Event {}')).toEqual([used('Event'), used('Response')]));
});

describe('a new declaration with a name nothing locked uses is fine', () => {
  test('a local interface named like a browser type', () => expect(bent('interface Request {}')).toEqual([]));
  test('a new import named like a type that nothing uses', () => expect(bent("import { Request } from 'express';")).toEqual([]));
  test('a new type, class and enum', () => expect(bent('type Cents = number;\nclass Box {}\nenum Kind { A }')).toEqual([]));
  test('a name that only appears inside a function body', () => {
    const inBody = total({ params: SIGNATURE, body: ['const x: Local = 1;', 'void x;'] });
    expect(check(`${inBody}interface Local {}\n`, lockOf(inBody), withPackages)).toEqual([]);
  });
  test('a name that is a type parameter of the signature', () => {
    const generic = total({ top: ['type Wrapper<T> = { v: T };'], params: 'a: Wrapper<number>' });
    expect(check(`${generic}type T = 1;\n`, lockOf(generic), withPackages)).toEqual([]);
  });
  test('a declaration the lock already has, unchanged', () => {
    const typed = total({ top: ['type Money = number;'], params: 'a: Money' });
    expect(check(typed.replace('return a + b;', 'return a;'), lockOf(typed), withPackages)).toEqual([]);
  });
  test('an import that the lock already has, unchanged', () => {
    const imported = total({ top: ["import type { Money } from 'immutable';"], params: 'a: Money' });
    expect(check(imported.replace('return a + b;', 'return a;'), lockOf(imported), withPackages)).toEqual([]);
  });
});

describe('what counts as a type a locked thing uses', () => {
  const refs = (src: string): string[] => collectTypeRefs(parseSource('f.ts', src));
  test('names in signatures, heritage clauses and typeof, by their leftmost part, outside function bodies', () => {
    const src = [
      'export function f(a: A.B.C, b: Map<K, V>, c: typeof R): Promise<void> {}',
      'class X extends Y implements Z {}',
      'interface I extends J {}',
      'export function g<T>(a: T): T { const x: Body = 1; return a; }',
      'type M = { [P in Keys]: P };',
      'type C<U> = U extends infer W ? W : never;',
    ].join('\n');
    expect(refs(src)).toEqual(['A', 'J', 'K', 'Keys', 'Map', 'Promise', 'R', 'V', 'Y', 'Z']);
  });
  test('the lock records them, sorted and once each', () => {
    expect(fingerprintCode('f.ts', 'export function f(a: B, b: A, c: B): C {}').typeRefs).toEqual(['A', 'B', 'C']);
  });
  test('a class keeps the types of its members and drops the types inside its method bodies', () => {
    expect(refs('class Box { x: Item = make(); m(a: Arg): Ret { const y: Inner = 1; return a; } }')).toEqual(['Arg', 'Item', 'Ret']);
  });
});
