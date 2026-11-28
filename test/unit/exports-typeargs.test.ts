// R82 (Codex on PR #25): `typeof factory<typeof helper>` names two things, `factory` and, in the type argument, `helper`. The walk that finds
// what an exported arrow function mentions stopped at the name after `typeof` and never looked at the type arguments, so changing
// `helper` did not change the export's hash. The type arguments are types: what they name counts, and a type parameter of the arrow does not.
import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { mentions } from '../../src/lib/mentions.ts';

const exportHash = (src: string): string | undefined => fingerprintCode('src/a.ts', src).exports.total;
const expression = (text: string): ts.Expression => {
  const sf = ts.createSourceFile('x.ts', `const x = ${text};`, ts.ScriptTarget.Latest, true);
  const [stmt] = sf.statements;
  if (!ts.isVariableStatement(stmt) || stmt.declarationList.declarations[0].initializer === undefined) throw new Error('Test setup: not an expression.');
  return stmt.declarationList.declarations[0].initializer;
};

describe('mentions: the type arguments of a type query', () => {
  test.each([
    ['(n: typeof factory<typeof helper>) => 1', ['factory', 'helper']],
    ['(n: typeof factory<Options>) => 1', ['factory', 'Options']],
    ['(n: typeof factory<Options, typeof a.b>) => 1', ['factory', 'Options', 'a']],
    ['(n: typeof factory<Wrap<Inner>>) => 1', ['factory', 'Wrap', 'Inner']],
    ['<T>(n: typeof factory<T>) => 1', ['factory']],
    ['(n: typeof factory<typeof n>) => 1', ['factory']], // the parameter is the arrow's own
    ['(n: typeof helper) => 1', ['helper']],
  ])('%s', (text, expected) => {
    expect(mentions(expression(text)).sort()).toEqual([...expected].sort());
  });
});

describe('an exported arrow whose parameter type is `typeof factory<typeof helper>`', () => {
  const src = (helperReturn: string) =>
    `function factory<T>(x: T): T { return x; }\nfunction helper(): ${helperReturn} { throw new Error('x'); }\nconst total = (n: typeof factory<typeof helper>): number => 1;\nexport { total };`;

  test('changing the helper changes the export', () => {
    expect(exportHash(src('number'))).not.toBe(exportHash(src('string')));
  });

  test('a local TYPE in the type argument counts too', () => {
    const withType = (field: string) => `interface Options { a: ${field} }\nfunction factory<T>(x: T): T { return x; }\nconst total = (n: typeof factory<Options>): number => 1;\nexport { total };`;
    expect(exportHash(withType('number'))).not.toBe(exportHash(withType('string')));
  });

  test('a type parameter in the type argument is the arrow\'s own, not a local of the same name', () => {
    const withAlias = (alias: string) => `type T = ${alias};\nfunction factory<U>(x: U): U { return x; }\nconst total = <T>(n: typeof factory<T>): number => 1;\nexport { total };`;
    expect(exportHash(withAlias('string'))).toBe(exportHash(withAlias('number')));
  });

  test('an unrelated change to the helper\'s body still changes nothing', () => {
    const body = (text: string) => `function factory<T>(x: T): T { return x; }\nfunction helper(): number { return ${text}; }\nconst total = (n: typeof factory<typeof helper>): number => 1;\nexport { total };`;
    expect(exportHash(body('1'))).toBe(exportHash(body('2')));
  });
});
