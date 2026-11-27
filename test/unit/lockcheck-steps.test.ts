// Review fixes: a look-alike function can't take over the step markers (critical 1), a marker in an
// unnamed callback counts for the function around it (R30), and only plain spacing is squeezed.
import { describe, expect, test } from 'vitest';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { formatHeader } from '../../src/formats/header.ts';
import { planFile, skeleton } from '../helpers/code.ts';
import { MARKERS, S2, check, edit, lockFor, plan } from '../helpers/lockcheck.ts';

const ALL_THREE = ['step 1', 'step 2', 'step 3'].map((s) => `${s} in total was changed or removed`);
/** The filled total with its three markers taken out, and a look-alike holding them. */
const stripped = (): string => edit(`${MARKERS}\n`, '');
const markers = `${MARKERS}\n`;

describe('a function that looks like the exported one can not take over its steps', () => {
  const above = (decoy: string): string => stripped().replace('export function total', `${decoy}\nexport function total`);
  const below = (decoy: string): string => `${stripped()}\n${decoy}\n`;
  const decoys: [string, string][] = [
    ['an object method', `const d = { total() {\n${markers}} };`],
    ['an object property that is an arrow', `const d = { total: () => {\n${markers}} };`],
    ['an object property that is a function', `const d = { total: function () {\n${markers}} };`],
    ['a named function expression', `const d = function total() {\n${markers}};`],
    ['a named function expression given to memo', `const d = memo(function total() {\n${markers}});`],
    ['a named function expression given to forwardRef', `const d = forwardRef(function total(p, ref) {\n${markers}});`],
    ['an arrow kept in a name', `const total2 = () => {\n${markers}};`],
    ['a class method', `class D { total() {\n${markers}} }`],
    ['a function inside another function', `function x() {\n  function total() {\n${markers}  }\n}`],
    ['an object with the name of the export', `const total = { total() {\n${markers}} };`],
  ];
  test.each(decoys)('%s, above the real one', (_name, decoy) => expect(check(above(decoy))).toEqual(expect.arrayContaining(ALL_THREE)));
  test.each(decoys)('%s, below the real one', (_name, decoy) => expect(check(below(decoy))).toEqual(expect.arrayContaining(ALL_THREE)));

  test('a second function of the same name is reported, wherever it is', () => {
    for (const text of [above(`function total() {\n${markers}}`), below(`function total() {\n${markers}}`)]) {
      expect(check(text)).toEqual(expect.arrayContaining(["'total' is declared more than once", "more than one function is called 'total', so its steps can't be told apart"]));
    }
  });

  test('two functions that share a locked name are reported, so their markers are not mixed up', () => {
    const { seam, file } = planFile('src/pricing/total.ts');
    const nested = 'export function total(a: number, b: number): number {\n  function done() {\n    // Step 1: one\n  }\n  return done();\n}\n';
    const text = `${formatHeader(seam, file)}\n${nested}`;
    const locked = lockFor('src/pricing/total.ts', text);
    const twice = text.replace('  return done();', '  function done() {\n    // Step 1: two\n  }\n  return done();');
    expect(checkAgainstLock('src/pricing/total.ts', twice, locked, plan)).toContain("more than one function is called 'total>done', so its steps can't be told apart");
  });
});

describe('markers in unnamed callbacks (R30)', () => {
  test('a marker inside a forEach callback counts for the function around it', () => {
    const text = edit(`  // Step 2: ${S2}\n`, `  [a, b].forEach((x) => {\n    // Step 2: ${S2}\n    void x;\n  });\n`);
    expect(check(text)).toEqual([]);
  });
  test('a marker inside a function expression handed to a call', () => {
    const text = edit(`  // Step 2: ${S2}\n`, `  run(function () {\n    // Step 2: ${S2}\n  });\n`);
    expect(check(text)).toEqual([]);
  });
  test('a callback inside a callback', () => {
    const text = edit(`  // Step 2: ${S2}\n`, `  run(() => {\n    other(() => {\n      // Step 2: ${S2}\n    });\n  });\n`);
    expect(check(text)).toEqual([]);
  });
  test('a React effect in a screen', () => {
    const path = 'src/greeting/Greeting.tsx';
    const { seam, file } = planFile(path);
    const screen = [
      formatHeader(seam, file), "import { useEffect } from 'react';", '',
      'export function Greeting(props: { name: string }): JSX.Element {',
      `  // Step 1: ${file.steps[0]}`, '  useEffect(() => {', `    // Step 2: ${file.steps[1]}`, '  }, []);',
      `  // Step 3: ${file.steps[2]}`, '  return <h1>Hello, {props.name}!</h1>;', '}', '',
    ].join('\n');
    expect(checkAgainstLock(path, screen, lockFor(path, skeleton(seam, file)), plan)).toEqual([]);
  });
  test('a callback does not hide a marker that left the function for another function', () => {
    const text = `${edit(`  // Step 2: ${S2}\n`, '')}\nfunction other() {\n  run(() => {\n    // Step 2: ${S2}\n  });\n}\n`;
    expect(check(text)).toContain('step 2 in total was changed or removed');
  });
  test('a named function handed to a call keeps its own steps', () => {
    const text = edit(`  // Step 2: ${S2}\n`, `  run(function step() {\n    // Step 2: ${S2}\n  });\n`);
    expect(check(text)).toContain('step 2 in total was changed or removed');
  });
  test('an arrow kept in a name keeps its own steps', () => {
    const text = edit(`  // Step 2: ${S2}\n`, `  const step = () => {\n    // Step 2: ${S2}\n  };\n`);
    expect(check(text)).toContain('step 2 in total was changed or removed');
  });
});

describe('only plain spacing counts as spacing', () => {
  const nbsp = String.fromCharCode(0xa0);
  test('a non-breaking space before the word Step makes the marker no marker', () =>
    expect(check(edit(`// Step 2: ${S2}`, `//${nbsp}Step 2: ${S2}`))).toEqual(expect.arrayContaining(['step 2 in total was changed or removed'])));
  test('a non-breaking space inside the text is a change to the text', () =>
    expect(check(edit(`// Step 2: ${S2}`, `// Step 2: ${S2.replace(' ', nbsp)}`))).toEqual(['step 2 in total was changed or removed']));
  test('extra spaces and tabs are not a change', () =>
    expect(check(edit(`// Step 2: ${S2}`, `//\tStep  2 :\t${S2}  `))).toEqual([]));
});
