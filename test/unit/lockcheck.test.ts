import { describe, expect, test } from 'vitest';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { TOTAL, skeleton, total } from '../helpers/code.ts';
import { FILLED, HEADER_END, P, S1, S2, S3, check, edit, file, lock, lockOf, plan, seam } from '../helpers/lockcheck.ts';

describe('what a builder may do', () => {
  test('filling the body is fine', () => expect(check(FILLED)).toEqual([]));
  test('the skeleton as it stands is fine', () => expect(check(skeleton(seam, file))).toEqual([]));
  test('CRLF line endings are fine', () => expect(check(FILLED.replace(/\n/g, '\r\n'))).toEqual([]));
  test('a doc comment on the function and ordinary comments in the body are fine', () =>
    expect(check(edit('export function', '/** Adds. */\nexport function').replace('return a + b', '// plain note\n  return a + b'))).toEqual([]));
  test('private helpers are fine, however many', () =>
    expect(check(`${FILLED}\nfunction h() { return 1; }\nconst k = () => 2;\nclass C {}\ntype T = number;`)).toEqual([]));
  test('a step marker may sit inside a block of the same function', () =>
    expect(check(edit(`  // Step 2: ${S2}\n`, `  if (a) {\n    // Step 2: ${S2}\n  }\n`))).toEqual([]));
  test('a helper with its own step markers is fine', () =>
    expect(check(`${FILLED}\nfunction h() {\n  // Step 1: help\n  return 1;\n}`)).toEqual([]));
  test('importing a package the plan lists is fine', () => {
    expect(check(edit(HEADER_END, `${HEADER_END}import { useMemo } from 'react';\n`))).toEqual([]);
  });
  test('importing a planned file is fine, with or without its extension', () => {
    for (const spec of ['../greeting/Greeting', '../greeting/Greeting.tsx', '../greeting/Greeting.js']) {
      expect(check(edit(HEADER_END, `${HEADER_END}import { Greeting } from '${spec}';\n`)), spec).toEqual([]);
    }
  });
  test('a planned import that is still there is fine', () => {
    const withImport = edit(HEADER_END, `${HEADER_END}import '../greeting/Greeting';\n`);
    expect(check(withImport, lockOf(withImport))).toEqual([]);
  });
});

describe('the brief', () => {
  test('private helper is fine, exported helper is not', () => {
    expect(check(`${FILLED}\nfunction h() { return 1; }`)).toEqual([]);
    expect(check(`${FILLED}\nexport function h() { return 1; }`)).toEqual(["new export 'h' isn't in the plan"]);
  });

  test('swapped steps are caught', () => {
    const swapped = total({ steps: [S2, S1, S3] });
    expect(check(swapped)).toContain('step 1 in total was changed or removed');
    expect(check(swapped)).toContain('step 2 in total was changed or removed');
  });

  test('changed signature is caught', () =>
    expect(check(total({ params: 'a: number, b: string' }))).toContain("export total's signature changed"));
});

describe('the header', () => {
  const only = ['the header was changed'];
  test('a trimmed header', () => expect(check(edit(' * Promises:\n *  P-pricing-1: total(2, 3) returns 5\n', ' * Promises:\n'))).toEqual(only));
  test('a changed word in the header', () => expect(check(edit('Add two prices', 'Add three prices'))).toEqual(only));
  test('a changed line inside the header, in a place the plan texts do not cover', () =>
    expect(check(edit(' * Steps:', ' * Steps: (see code)'))).toEqual(only));
  test('the header split into two comments', () =>
    expect(check(edit(' * Promises:', ' */\n/**\n * Promises:'))).toEqual(only));
  test('the header turned into a plain block comment', () => expect(check(FILLED.replace('/**', '/*'))).toEqual(only));
  test('the header with another comment put in front of it', () => expect(check(`// first\n${FILLED}`)).toEqual(only));
  test('the header deleted', () => expect(check(FILLED.slice(FILLED.indexOf('export function')))).toEqual(only));
});

describe('signatures', () => {
  const sig = ["export total's signature changed"];
  test('a parameter renamed', () => expect(check(edit('(a: number, b', '(x: number, b').replace('a + b', 'x + b'))).toEqual(sig));
  test('a return type changed', () => expect(check(edit('): number {', '): string {').replace('a + b', 'String(a + b)'))).toEqual(sig));
  test('a default value added', () => expect(check(edit('b: number)', 'b: number = 0)'))).toEqual(sig));
  test('async added', () => expect(check(edit('export function', 'export async function'))).toEqual(sig));
  test('the export removed from the function', () =>
    expect(check(edit('export function', 'function'))).toEqual(['export total was removed']));
  test('the function exported again by name instead is the same export', () =>
    expect(check(edit('export function', 'function').concat('export { total };\n'))).toEqual([]));
  test('the function renamed to something else exported', () =>
    expect(check(edit('function total', 'function sum'))).toEqual(
      expect.arrayContaining(['export total was removed', "new export 'sum' isn't in the plan"])));
  test('export added to a private helper', () => {
    const before = lockOf(`${skeleton(seam, file)}\nfunction h() { return 1; }\n`);
    expect(check(`${FILLED}\nfunction h() { return 1; }\n`, before)).toEqual([]);
    expect(check(`${FILLED}\nexport function h() { return 1; }\n`, before)).toEqual(["new export 'h' isn't in the plan"]);
  });
  test('a private helper exported by name', () =>
    expect(check(`${FILLED}\nfunction h() { return 1; }\nexport { h };\n`)).toEqual(["new export 'h' isn't in the plan"]));
  test('a re-export of something else', () =>
    expect(check(`${FILLED}\nexport { x as y } from './x';\n`)).toEqual(["new export 'y' isn't in the plan", "import of './x' isn't in the plan"]));
  test('a default export', () =>
    expect(check(`${FILLED}\nexport default function () {}\n`)).toEqual(["new export 'default' isn't in the plan"]));
});

describe('steps', () => {
  const at = (n: number): string[] => [`step ${n} in total was changed or removed`];
  test('one character of a marker changed', () => expect(check(edit(`// Step 2: ${S2}`, `// Step 2: ${S2}.`))).toEqual(at(2)));
  test('a marker changed by a letter in the middle', () => expect(check(edit(`// Step 1: ${S1}`, `// Step 1: ${S1.replace('first', 'frist')}`))).toEqual(at(1)));
  test('a marker removed from the end', () =>
    expect(check(edit(`  // Step 3: ${S3}\n`, ''))).toEqual(at(3)));
  test('a marker removed from the middle', () =>
    expect(check(edit(`  // Step 2: ${S2}\n`, ''))).toEqual([...at(2), ...at(3)]));
  test('a marker renumbered', () => expect(check(edit('Step 3:', 'Step 4:'))).toEqual(at(3)));
  test('a marker turned into a block comment', () => expect(check(edit(`// Step 2: ${S2}`, `/* Step 2: ${S2} */`))).toEqual([...at(2), ...at(3)]));
  test('a marker in a string does not count as the marker', () =>
    expect(check(edit(`// Step 2: ${S2}`, `const s = "// Step 2: ${S2}";`))).toEqual([...at(2), ...at(3)]));
  test('a marker duplicated', () =>
    expect(check(edit(`  // Step 3: ${S3}\n`, `  // Step 3: ${S3}\n  // Step 3: ${S3}\n`))).toEqual(["step 4 in total isn't in the plan"]));
  test('a marker added', () =>
    expect(check(edit('  return a + b;', '  // Step 4: extra\n  return a + b;'))).toEqual(["step 4 in total isn't in the plan"]));
  test('a marker moved into a nested helper', () => {
    const moved = edit(`  // Step 2: ${S2}\n`, '').replace('return a + b;', `const add = () => {\n    // Step 2: ${S2}\n    return a + b;\n  };\n  return add();`);
    expect(check(moved)).toContain('step 2 in total was changed or removed');
    expect(check(moved)).toContain('step 3 in total was changed or removed');
  });
  test('the last marker moved into a nested helper keeps the order of markers in the file, and is still caught', () => {
    const moved = edit(`  // Step 3: ${S3}\n  return a + b;`, `  const done = () => {\n    // Step 3: ${S3}\n    return a + b;\n  };\n  return done();`);
    expect(check(moved)).toEqual(['step 3 in total was changed or removed']);
  });
  test('a marker moved to a nested named function', () => {
    const moved = edit(`  // Step 2: ${S2}\n`, '').replace('return a + b;', `function add() {\n    // Step 2: ${S2}\n    return a + b;\n  }\n  return add();`);
    expect(check(moved)).toContain('step 2 in total was changed or removed');
  });
  test('a marker moved to another function in the file', () => {
    const moved = `${edit(`  // Step 2: ${S2}\n`, '')}\nfunction other() {\n  // Step 2: ${S2}\n}\n`;
    expect(check(moved)).toContain('step 2 in total was changed or removed');
  });
  test('a marker moved out of the file body to the top', () =>
    expect(check(`// Step 2: ${S2}\n${edit(`  // Step 2: ${S2}\n`, '')}`)).toContain('step 2 in total was changed or removed'));
  test('all the steps gone with the function renamed', () =>
    expect(check(edit('function total', 'function sum'))).toEqual(
      expect.arrayContaining(['step 1 in total was changed or removed', 'step 3 in total was changed or removed'])));
  test('a marker moved into a second function with the same name is still caught', () => {
    const decoy = `const o = { total() {\n  // Step 2: ${S2}\n} };\n`;
    const moved = `${decoy}${edit(`  // Step 2: ${S2}\n`, '')}`;
    expect(check(moved)).toContain('step 2 in total was changed or removed');
  });
});

describe('imports', () => {
  const withImport = (line: string): string => edit(HEADER_END, `${HEADER_END}${line}\n`);
  test('a package that is not in the plan', () =>
    expect(check(withImport("import _ from 'lodash';"))).toEqual(["import of 'lodash' isn't in the plan"]));
  test('a deep import of a package that is not in the plan', () =>
    expect(check(withImport("import f from 'lodash/fp';"))).toEqual(["import of 'lodash/fp' isn't in the plan"]));
  test('a deep import of a package that is in the plan', () =>
    expect(check(withImport("import { jsx } from 'react/jsx-runtime';"))).toEqual([]));
  test('a Node module', () =>
    expect(check(withImport("import * as fs from 'node:fs';"))).toEqual(["import of 'node:fs' isn't in the plan"]));
  test('a file that is not planned', () =>
    expect(check(withImport("import { x } from './secret';"))).toEqual(["import of './secret' isn't in the plan"]));
  test('a planned file name reached from the wrong folder', () =>
    expect(check(withImport("import { x } from './Greeting';"))).toEqual(["import of './Greeting' isn't in the plan"]));
  test('a package named only in this file entry of the plan is fine', () => {
    const named = { ...plan, seams: plan.seams.map((s) => ({ ...s, files: s.files.map((f) => (f.path === P ? { ...f, imports: ['left-pad'] } : f)) })) };
    expect(check(withImport("import l from 'left-pad';"), lock, named)).toEqual([]);
  });
  test('a file named by path in this file entry of the plan is fine, spelled any way that reaches it', () => {
    const named = { ...plan, seams: plan.seams.map((s) => ({ ...s, files: s.files.map((f) => (f.path === P ? { ...f, imports: ['contracts/api.ts'] } : f)) })) };
    expect(check(withImport("import { A } from '../../contracts/api';"), lock, named)).toEqual([]);
    expect(check(withImport("import { A } from '../../contracts/other';"), lock, named)).toEqual(["import of '../../contracts/other' isn't in the plan"]);
  });
  test('a planned import removed', () => {
    const planned = lockOf(withImport("import '../greeting/Greeting';"));
    expect(check(FILLED, planned)).toEqual(["the planned import of '../greeting/Greeting' was removed"]);
  });
  test('an export-from counts as an import', () =>
    expect(check(`${FILLED}\nexport * from 'lodash';\n`)).toEqual(["new export '* from lodash' isn't in the plan", "import of 'lodash' isn't in the plan"]));
});

describe('files the lock does not describe', () => {
  test('a path the lock has no entry for', () =>
    expect(checkAgainstLock('src/other.ts', FILLED, lock, plan)).toEqual(["src/other.ts isn't a file the lock covers"]));
  test('a file locked whole can not be changed at all', () =>
    expect(checkAgainstLock('a.json', '{}', { version: 1, files: { 'a.json': { kind: 'whole', hash: 'x' } } }, plan))
      .toEqual(['a.json is locked whole and can\'t be changed']));
  test('a Windows-style path finds the same entry', () => expect(checkAgainstLock(P.replace(/\//g, '\\'), FILLED, lock, plan)).toEqual([]));
});
