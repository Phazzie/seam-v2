// R61: Windows PowerShell 5.1 (the PowerShell tool) hands a program its words with the old quoting. A word that holds a
// space is wrapped in double quotes without escaping what is inside, so a `\"` or a trailing backslash in it ends the
// argument early and the rest becomes new arguments; `--%` splits single-quoted text again and expands %VAR%; `@name`
// splats. So in the PowerShell tool a word with a space or a `"`, a backslash at the end of a word or by a quote, any `%`
// and any `@` are refused. The Bash tool is not changed by any of it.
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { commandScene, expectRuns, whyNot } from '../helpers/command.ts';
import type { Scene } from '../helpers/decide.ts';

let s: Scene;
beforeAll(async () => {
  s = await commandScene();
});

const QUOTING = /^a word with a space or a double quote, or a backslash at the end of a word or next to a quote, is not allowed in a PowerShell command/;
const EXPAND = /^a %, a @ or --% is not allowed in a PowerShell command/;
const ps = { tool: 'PowerShell' } as const;

describe('R61: the probes from the review, in the PowerShell tool', () => {
  test.each([
    ['git log -1 "--format=echo hi" \'x\\" --output=.git/hooks/pre-commit\'', QUOTING],
    ["git log -1 'a b\\' 'c --output=x'", QUOTING],
    ["git diff --% 'HEAD --output=x '", EXPAND],
    ["git log -1 'x\\\" --output=.claude/settings.json'", QUOTING],
    ["git diff 'HEAD\\\" --ext-diff'", QUOTING],
    ["npx vitest run 'test/a.test.ts\\\" --config=evil.mjs'", QUOTING],
    ['git diff --% %CLAUDE_JOB_DIR%', EXPAND],
    ['git diff @HOME', EXPAND],
    ['git diff @env:HOME', EXPAND],
  ] as [string, RegExp][])('%s', (command, reason) => expect(whyNot(s, command, ps)).toMatch(reason));
});

describe('R61: any % and any @', () => {
  test.each(['git log --format=%h', 'git log --format=%h%n', 'git diff %HOME%', 'git diff --%', 'git diff -- --% x', 'git log --grep=100%', 'seam request a@b', 'git log --author=me@x.com', 'git diff @'])(
    '%s', (command) => expect(whyNot(s, command, ps)).toMatch(EXPAND),
  );
});

describe('R61: a word with a space or a double quote', () => {
  test.each([
    'git log --grep="a b"', "git log --grep='a b'", "git log 'a b'", 'git log "a b"', 'seam request "freeze it"', "git log --format='x y'", 'git log --grep="a b" -n 5',
    "git log 'a\"b'", "git log --grep='say \"hi\"'", "git diff 'a\tb'", 'git log "a" "b c"',
  ])('%s', (command) => expect(whyNot(s, command, ps)).toMatch(QUOTING));
  test('a quote around a whole word that holds no space is only a quote, and goes', () => {
    expectRuns(s, 'git diff "HEAD~1" -- "src/a.ts"', ps);
    expectRuns(s, "git log 'abc' -n 5", ps);
    expectRuns(s, "git log -n '5'", ps);
    expectRuns(s, 'git log "--oneline"', ps);
  });
});

describe('R61: a quote that is not around a whole word (PowerShell 5.1 splits \'a\'--output=x into a and --output=x)', () => {
  test.each([
    "git diff 'a'--output=x", 'git diff "a"--output=x', "git diff 'a'b", 'git diff "a"b', "git log -1 'HEAD'--ext-diff", "git diff 'a'--no-index",
    "git diff a''--output=x", "git diff a'b'", 'git diff a"b"', "git diff --output='x'", 'git log --grep="abc"', "git log --grep='abc' -n 5", "git diff 'a''b'",
    "git diff '--output'=x", "git diff -'-output=x'", "git diff ''--output=x", 'git log "abc', "git log 'abc", "git diff 'a\"b'", 'git diff "a\'b"', "npx vitest run 'a.test.ts'--config=evil.mjs",
  ])('%s', (command) => expect(whyNot(s, command, ps)).toMatch(QUOTING));
  test('the same words are fine in Bash, where a quote closed in front of text keeps the word whole', () => {
    expectRuns(s, "git diff 'a'b");
    expectRuns(s, 'git log --grep="abc"');
    expectRuns(s, "git diff a'b'");
  });
  test('and in Bash the option is still found', () => {
    expect(whyNot(s, "git diff ''--output=x")).toMatch(/can write a file or run a program/);
    expect(whyNot(s, "git diff --output='x'")).toMatch(/can write a file or run a program/);
  });
});

describe('R61: a backslash at the end of a word or next to a quote', () => {
  test.each([
    'git diff src\\', 'git diff src\\ x', "git diff 'a\\'", "git diff 'a'\\b", "git diff \\'a'", 'git diff "C:\\x\\"', "git diff a\\'b", 'git diff a\\"b', 'git diff "a"\\',
  ])('%s', (command) => expect(whyNot(s, command, ps)).toMatch(QUOTING));
  test('a backslash inside a word is an ordinary path', () => {
    expectRuns(s, 'git diff src\\pricing\\total.ts', ps);
    expectRuns(s, 'git log -- src\\pricing', ps);
    expectRuns(s, 'git show HEAD:src\\pricing\\total.ts', ps);
  });
});

describe('R61: plain commands still run in the PowerShell tool', () => {
  test.each([
    'git status', 'git log -1', 'git log --oneline -n 5', 'git diff HEAD~1 -- src/pricing/total.ts', 'git show HEAD:src/pricing/total.ts', 'git branch -vv',
    'npm run typecheck', 'npm test', 'npx vitest run test/a.test.ts', 'seam report', 'seam request freeze', 'node --version', 'git log --author=me',
  ])('%s', (command) => expectRuns(s, command, ps));
  test("the plugin's script by its path, in either quoting", () => {
    const script = join(s.app.pluginRoot, 'dist', 'seam.mjs');
    expectRuns(s, `node '${script.replace(/\\/g, '/')}' report`, ps);
    expectRuns(s, `node "${script}" report`, ps);
    expectRuns(s, `node ${script} status`, ps);
  });
});

describe('R61: the Bash tool is not changed', () => {
  test.each([
    'git log --format=%h', 'git log --grep="a b"', "git log --grep='a b' --format='%h %s'", 'git diff @HOME', 'git log --author=me@x.com', 'git log -1 --format="%h %s"',
    'git log --grep=100%', 'git diff src\\pricing\\total.ts', 'git diff "C:\\x\\y.ts"',
  ])('%s', (command) => expectRuns(s, command));
  test('what Bash refuses for its own reasons is still refused', () => {
    expect(whyNot(s, "git log -1 'a b\\' 'c --output=x'")).toMatch(/^a backslash before -, =, a quote or a space is not allowed in a Bash command/);
    expect(whyNot(s, "git log -1 'x\\\" --output=.claude/settings.json'")).toMatch(/^a backslash before -, =, a quote or a space/);
  });
});
