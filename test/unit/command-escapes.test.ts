// R56: the option checks read the words the shell passes on, not the raw text. A command is refused when its words
// could differ from what the guard sees: a backslash escape in Bash, a character that is not ASCII (non-breaking
// spaces and curly quotes are word breaks and quotes to PowerShell), a comma in PowerShell (a list); and every
// option check is also made on the words with the backslash escapes taken out.
import { beforeAll, describe, expect, test } from 'vitest';
import { commandScene, expectRuns, whyNot } from '../helpers/command.ts';
import type { Scene } from '../helpers/decide.ts';

let s: Scene;
beforeAll(async () => {
  s = await commandScene();
});

const NBSP = String.fromCodePoint(0xa0);
const q = (code: number): string => String.fromCodePoint(code);
const BACKSLASH = /^a backslash before -, =, a quote or a space is not allowed in a Bash command/;
const ASCII_ONLY = /^plain ASCII only/;
const COMMA = /^a comma is not allowed in a PowerShell command/;
const OPTION = /isn't allowed here: (?:that option can write a file or run a program|that option reads files outside git|git branch only lists|it takes test file paths only)/;

describe('R56 (c): a backslash that the Bash tool takes out before the program sees the word', () => {
  test.each([
    'git diff \\--output=evil.txt', 'git diff -\\-output=evil.txt', 'git diff --output\\=x', 'git log -1 --format=x \\--output=.seam/state.json',
    'git diff \\--ext-diff', 'git diff \\--no-index a b', 'git diff \\--textconv', 'npx vitest run \\--config=evil.config.ts', 'npx vitest run \\-c x',
    'git log \\"x', "git log \\'x", 'git log a\\ b', 'git log a\\', 'git log --format=\\=x', 'git branch \\-D x',
  ])('Bash: %s', (command) => expect(whyNot(s, command)).toMatch(BACKSLASH));

  test('only the Bash tool: PowerShell takes a backslash as it is, and the unescaped reading still catches the option', () => {
    expect(whyNot(s, 'git diff \\--output=evil.txt', { tool: 'PowerShell' })).toMatch(OPTION);
    expect(whyNot(s, 'git diff -\\-ext-diff', { tool: 'PowerShell' })).toMatch(OPTION);
    expect(whyNot(s, 'npx vitest run \\--config=evil.config.ts', { tool: 'PowerShell' })).toMatch(OPTION);
  });
});

describe('R56 (d): every option check is made on the words with the backslash escapes taken out too', () => {
  test.each([
    ['git diff --out\\put=evil.txt', /can write a file or run a program/],
    ['git log --ex\\t-diff', /can write a file or run a program/],
    ['git show --text\\conv', /can write a file or run a program/],
    ['git diff --no-ind\\ex a b', /reads files outside git/],
    ['git branch -\\d x', /git branch only lists/],
    ['git branch -\\D x', /git branch only lists/],
    ['git branch --dele\\te x', /git branch only lists/],
    ['git branch --list a --m\\ove', /git branch only lists/],
    ['npx vitest run --conf\\ig=x', /takes test file paths only/],
    ['npx vitest run a.test.ts --cover\\age', /takes test file paths only/],
  ] as [string, RegExp][])('%s', (command, reason) => {
    for (const tool of ['Bash', 'PowerShell'] as const) expect(whyNot(s, command, { tool }), tool).toMatch(reason);
  });

  test('an honest backslash is fine: a Windows path, in either shell', () => {
    for (const tool of ['Bash', 'PowerShell'] as const) {
      expectRuns(s, 'git diff src\\pricing\\total.ts', { tool });
      expectRuns(s, 'git log -- src\\pricing\\total.ts', { tool });
      expectRuns(s, 'git show HEAD:src\\pricing\\total.ts', { tool });
    }
  });
});

describe('R56 (a): a character that is not ASCII is refused, in either shell', () => {
  const SPACES = [0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0x85, 0x200b, 0xfeff];
  test.each(SPACES)('U+%s where a space would be', (code) => {
    for (const tool of ['Bash', 'PowerShell'] as const) {
      expect(whyNot(s, `git diff HEAD${q(code)}--output=evil.txt`, { tool }), tool).toMatch(ASCII_ONLY);
    }
  });
  test.each([0x2018, 0x2019, 0x201a, 0x201b, 0x201c, 0x201d, 0x201e])('the curly quote U+%s, which PowerShell reads as a quote', (code) => {
    expect(whyNot(s, `git diff ${q(code)}--output=evil.txt${q(code)}`, { tool: 'PowerShell' })).toMatch(ASCII_ONLY);
    expect(whyNot(s, `git diff ${q(code)}x${q(code)} --output=evil.txt`, { tool: 'PowerShell' })).toMatch(ASCII_ONLY);
  });
  test('anywhere in the command, in a word or in a quote', () => {
    expect(whyNot(s, 'git log --author=Jos' + q(0xe9))).toMatch(ASCII_ONLY);
    expect(whyNot(s, 'git log "' + q(0x4e2d) + '"')).toMatch(ASCII_ONLY);
    expect(whyNot(s, 'git status' + NBSP)).toMatch(ASCII_ONLY);
    expect(whyNot(s, 'npm' + NBSP + 'test')).toMatch(ASCII_ONLY);
  });
  test('the reason is a plain sentence that says it is not allowed', () => expect(whyNot(s, 'git log' + NBSP + 'x')).toMatch(/not allowed/));
  test('plain ASCII with every printable character is not refused for that', () => {
    expectRuns(s, 'git log --format=%h:%s --since="2 weeks ago" -n 5 --author=me@x.com');
  });
});

describe('R56 (b): a comma in a PowerShell command is refused', () => {
  test.each([
    'git diff HEAD,--output=evil.txt', 'git diff HEAD,--no-index', 'git log --format=%h,%s', 'git diff a,b', 'npx vitest run a,--config=evil.ts',
    'npx vitest run a.test.ts,b.test.ts', 'git log -1,2', 'seam request freeze,x', 'git branch --list a,b',
  ])('PowerShell: %s', (command) => expect(whyNot(s, command, { tool: 'PowerShell' })).toMatch(COMMA));
  test('a comma in a Bash command is only a character, and the option checks still run', () => {
    expectRuns(s, 'git log --format=%h,%s');
    expectRuns(s, 'git diff a,b');
    expectRuns(s, 'git diff HEAD,--output=evil.txt'); // one word to git, which is no option
  });
});
