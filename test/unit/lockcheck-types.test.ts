// Review fixes R27 (a file that doesn't parse) and R28 (local types are fixed too).
import { describe, expect, test } from 'vitest';
import { parseLock } from '../../src/formats/lock.ts';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { planFile, skeleton, total } from '../helpers/code.ts';
import { FILLED, check, edit, lockFor, lockOf, plan } from '../helpers/lockcheck.ts';

const GREETING = planFile('src/greeting/Greeting.tsx');
const GREETING_PATH = 'src/greeting/Greeting.tsx';

describe("a file that doesn't parse", () => {
  const brokenOnly = (problems: string[]): void => {
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^the file doesn't parse: .+ \(line \d+\)$/);
  };
  test('braces and parentheses left at the end', () => brokenOnly(check(`${FILLED}\n}}} ((((\n`)));
  test('garbage in a body', () => brokenOnly(check(edit('return a + b;', 'return a + ;'))));
  test('a variable with no name in a body', () => brokenOnly(check(edit('return a + b;', 'const = 1; return a + b;'))));
  test('a body that is never closed', () => brokenOnly(check(FILLED.replace(/\}\n$/, ''))));
  test('a string that is never closed', () => brokenOnly(check(edit('return a + b;', 'const s = "abc; return a + b;'))));
  test('a TSX screen with an unclosed tag', () => {
    const screen = skeleton(GREETING.seam, GREETING.file).replace("throw new Error('Not built yet');", 'return <h1>;');
    brokenOnly(checkAgainstLock(GREETING_PATH, screen, lockFor(GREETING_PATH, skeleton(GREETING.seam, GREETING.file)), plan));
  });
  test('names the first error and its line', () => {
    const extraBraceLine = FILLED.split('\n').length; // FILLED ends with a newline, so the added line comes right after its last
    expect(check(`${FILLED}}\n`)[0]).toBe(`the file doesn't parse: Declaration or statement expected. (line ${extraBraceLine})`);
  });
  test('a file that parses is not reported', () => expect(check(FILLED)).toEqual([]));
});

describe('local types are fixed', () => {
  const TYPED = total({ top: ['type Money = number;', 'interface Line { price: Money }', 'enum Kind { A, B }'], params: 'a: Money, b: Line' });
  const typed = lockOf(TYPED);
  const typedCheck = (text: string): string[] => check(text, typed);

  test('the typed file itself is fine', () => expect(typedCheck(TYPED)).toEqual([]));
  test('the lock names every type alias, interface, enum, class and variable, exported or not', () => {
    const src = 'type A = 1;\nexport type B = 2;\ninterface C {}\nexport interface D {}\nenum E { X }\nexport enum F { Y }\nconst G = 1;\nclass H {}';
    expect(Object.keys(fingerprintCode('a.ts', src).fixed ?? {}).sort()).toEqual(
      ['class H', 'const G', 'enum E', 'enum F', 'interface C', 'interface D', 'type A', 'type B']);
  });
  test('a local type alias changed from number to string', () =>
    expect(typedCheck(TYPED.replace('type Money = number', 'type Money = string'))).toEqual(['type Money was changed or removed']));
  test('a field of a local interface the signature uses changed', () =>
    expect(typedCheck(TYPED.replace('price: Money', 'price: string'))).toEqual(['interface Line was changed or removed']));
  test('a field added to the interface', () =>
    expect(typedCheck(TYPED.replace('price: Money }', 'price: Money; tax: number }'))).toEqual(['interface Line was changed or removed']));
  test('an enum member changed', () =>
    expect(typedCheck(TYPED.replace('A, B', 'A, B, C'))).toEqual(['enum Kind was changed or removed']));
  test('a local type taken out', () =>
    expect(typedCheck(TYPED.replace('type Money = number;\n', ''))).toEqual(['type Money was changed or removed']));
  test('an interface declared a second time (it would merge)', () =>
    expect(typedCheck(`${TYPED}\ninterface Line { extra: string }\n`)).toEqual(
      ['interface Line was changed or removed', "'Line' is declared more than once"]));
  test('a new local type is fine', () =>
    expect(typedCheck(`${TYPED}\ntype Extra = string;\ninterface More { a: 1 }\nenum Other { X }\n`)).toEqual([]));
  test('a new exported type is a new export', () =>
    expect(typedCheck(`${TYPED}\nexport type Shared = string;\n`)).toEqual(["new export 'Shared' isn't in the plan"]));
  test('an exported type that changed is reported once, as an export', () => {
    const exported = total({ top: ['export type Money = number;'], params: 'a: Money, b: Money' });
    expect(check(exported.replace('Money = number', 'Money = string'), lockOf(exported))).toEqual(["export Money's signature changed"]);
  });
  test('a code lock without the list of fixed things is not a lock', () => {
    const entry = lockOf(TYPED).files['src/pricing/total.ts'];
    if (entry.kind !== 'code') throw new Error('expected a code lock');
    const { fixed: _dropped, ...without } = entry;
    expect(() => parseLock({ version: 1, files: { 'src/pricing/total.ts': without } })).toThrow(/fixed/);
  });
});
