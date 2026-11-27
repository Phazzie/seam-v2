// In a .js or .jsx file the signature is written in JSDoc (`@param {number} a`, `@returns`, `@type`), so those type
// tags are part of the fingerprint of an exported declaration, and the words that describe them are not.
import { describe, expect, test } from 'vitest';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { lockFor, plan } from '../helpers/lockcheck.ts';

const HEADER = '/**\n * @seam pricing\n */\n';
const doc = (...lines: string[]): string => `/**\n${lines.map((l) => ` * ${l}`).join('\n')}\n */\n`;
const hashes = (path: string, src: string): Record<string, string> => fingerprintCode(path, HEADER + src).exports;
const fn = (tags: string[], body = 'return a;'): string => `${doc(...tags)}export function total(a) { ${body} }\n`;

describe('type tags in .js and .jsx files are part of the signature', () => {
  test.each(['f.js', 'f.jsx', 'f.mjs', 'f.cjs'])('%s: changing @param {number} to {string} is a change', (path) => {
    expect(hashes(path, fn(['@param {number} a']))).not.toEqual(hashes(path, fn(['@param {string} a'])));
  });

  test('a changed @returns, @type, @template, @this or optional-parameter default is a change', () => {
    const pairs: [string[], string[]][] = [
      [['@returns {number}'], ['@returns {string}']],
      [['@param {number} a', '@returns {number}'], ['@param {number} a']],
      [['@param {number} a'], ['@param {number} b']],
      [['@param {number} [a=1]'], ['@param {number} [a=2]']],
      [['@param {number} [a]'], ['@param {number} a']],
      [['@template T', '@param {T} a'], ['@template U', '@param {U} a']],
      [['@this {Window}'], ['@this {Document}']],
      [['@param {{ x: number }} a'], ['@param {{ x: string }} a']],
    ];
    for (const [before, after] of pairs) expect(hashes('f.js', fn(before)), before.join(' ')).not.toEqual(hashes('f.js', fn(after)));
  });

  test('@type on an exported constant, and on a value inside an exported object, are part of it', () => {
    expect(hashes('f.js', '/** @type {number} */\nexport const x = 1;')).not.toEqual(hashes('f.js', '/** @type {string} */\nexport const x = 1;'));
    const obj = (type: string): string => `export const api = {\n  /** @type {${type}} */\n  size: 1,\n};`;
    expect(hashes('f.js', obj('number'))).not.toEqual(hashes('f.js', obj('string')));
  });

  test('a class method\'s tags, and a constructor parameter\'s, are part of the class', () => {
    const cls = (type: string): string => `export class Box {\n  /**\n   * @param {${type}} a\n   */\n  open(a) { return a; }\n}`;
    expect(hashes('f.js', cls('number'))).not.toEqual(hashes('f.js', cls('string')));
  });

  test('the export default and the exports.x forms carry them too', () => {
    const dflt = (type: string): string => `/**\n * @param {${type}} a\n */\nexport default function (a) { return a; }`;
    expect(hashes('f.js', dflt('number'))).not.toEqual(hashes('f.js', dflt('string')));
    const cjs = (type: string): string => `/** @type {${type}} */\nexports.count = 1;`;
    expect(hashes('f.js', cjs('number'))).not.toEqual(hashes('f.js', cjs('string')));
  });

  test('through an alias: the tags of a private function are the tags of what is exported under another name', () => {
    const aliased = (type: string): string => `${doc(`@param {${type}} a`)}function work(a) { return a; }\nconst alias = work;\nexport { alias as total };`;
    expect(hashes('f.js', aliased('number'))).not.toEqual(hashes('f.js', aliased('string')));
  });

  test('a local constant that a signature leans on is fixed with its tags', () => {
    const local = (type: string): string => `/** @type {${type}} */\nconst RATE = 1;\n${fn(['@param {number} a'])}`;
    expect(fingerprintCode('f.js', HEADER + local('number')).fixed).not.toEqual(fingerprintCode('f.js', HEADER + local('string')).fixed);
  });
});

describe('only the type counts', () => {
  test('rewording a description, or the words after a tag, is not a change', () => {
    const before = fn(['Adds two prices.', '@param {number} a The first price', '@returns {number} The total']);
    const after = fn(['Totals up, in cents.', '@param {number}   a   First price (cents)', '@returns {number} What it comes to', '@deprecated use sum', '@example total(1)']);
    expect(hashes('f.js', after)).toEqual(hashes('f.js', before));
  });

  test('@return and @returns, @arg and @param, and spacing inside a tag, are the same', () => {
    expect(hashes('f.js', fn(['@return {number}', '@arg {number} a']))).toEqual(hashes('f.js', fn(['@returns  {number}', '@param   {number}   a'])));
  });

  test('a type tag written inside a function body, and the code of the body, are not part of the signature', () => {
    const body = (inner: string): string => fn(['@param {number} a'], `/** @type {number} */ const n = ${inner}; return n;`);
    expect(hashes('f.js', body('a + 1'))).toEqual(hashes('f.js', body('a * 2')));
    expect(hashes('f.js', fn(['@param {number} a'], '/** @type {string} */ const s = "x"; return a;'))).toEqual(hashes('f.js', fn(['@param {number} a'], 'return a;')));
  });

  test('in a .ts file JSDoc types mean nothing, so they are not added', () => {
    expect(hashes('f.ts', fn(['@param {number} a']))).toEqual(hashes('f.ts', fn(['@param {string} a'])));
  });
});

describe('the lock check says so', () => {
  const PATH = 'src/pricing/total.js';
  const against = (locked: string, proposed: string): string[] => checkAgainstLock(PATH, HEADER + proposed, lockFor(PATH, HEADER + locked), plan);

  test('@param {number} a changed to {string} is a changed signature', () => {
    const locked = fn(['@param {number} a'], 'throw new Error("x");');
    expect(against(locked, fn(['@param {string} a']))).toEqual(["export total's signature changed"]);
  });

  test('a filled-in body and a reworded description are fine', () => {
    const locked = fn(['Adds.', '@param {number} a The price'], 'throw new Error("x");');
    expect(against(locked, fn(['Adds one price to nothing.', '@param {number} a The first price, in cents'], 'return a + 0;'))).toEqual([]);
  });
});
