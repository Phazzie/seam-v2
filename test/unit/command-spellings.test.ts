// R62: ways to write a path that name another place than the words say, which the guard refuses in an allowed command:
// git's `:N:path` (the index at a stage), `:/path` (from the top), a path after a ref that starts at a root, the tilde
// forms `~+`, `~-` and `~name`, and `-L<range>:<path>`; and the value stuck to a one-letter option (`-O<file>`) is path-checked.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { commandScene, expectRuns, whyNot } from '../helpers/command.ts';
import type { Scene } from '../helpers/decide.ts';

let s: Scene;
beforeAll(async () => {
  s = await commandScene();
});

const TOOLS = ['Bash', 'PowerShell'] as const;
const SPELLING = /^that way of writing a path \(:N:path, :\/path, ~\+, ~-, ~name\) is not allowed; name the file plainly/;
const LINE_RANGE = /isn't allowed here: that option names a line range and a file/;

describe('R62: git :N:path and :/path', () => {
  test.each([
    'git show :0:.seam/state.json', 'git show :1:src/a.ts', 'git show :2:src/a.ts', 'git show :3:CLAUDE.md', 'git diff -- :0:.seam/state.json',
    'git show :/.seam/state.json', 'git show :/src/a.ts', 'git diff -- :/CLAUDE.md', 'git show :\\.seam\\state.json', 'git log -- :0:x',
    'git show HEAD:/.seam/state.json', 'git show HEAD:\\x', 'git show origin/main:/x',
  ])('%s', (command) => {
    for (const tool of TOOLS) expect(whyNot(s, command, { tool }), tool).toMatch(SPELLING);
  });
  test('the plain index form and a plain ref path are fine, and still checked as paths', () => {
    expectRuns(s, 'git show :src/pricing/total.ts');
    expectRuns(s, 'git show HEAD:src/pricing/total.ts');
    expectRuns(s, 'git show :./pricing/total.ts');
    expect(whyNot(s, 'git show :.seam/state.json')).toMatch(/records/);
  });
});

describe('R62: the tilde forms other than ~ and ~/', () => {
  test.each([
    'git diff -- ~+', 'git diff -- ~-', 'git diff ~+/.seam/state.json', 'git diff ~-/x', 'git diff ~root/.ssh/config', 'git diff ~trap/.claude/settings.json',
    'git log --grep=~x', 'git diff -- ~+/CLAUDE.md',
  ])('%s', (command) => {
    for (const tool of TOOLS) expect(whyNot(s, command, { tool }), tool).toMatch(SPELLING);
  });
  test('~ and ~/ are read as the home folder, and checked as that', () => {
    expect(whyNot(s, 'git diff ~/.claude/settings.json')).toMatch(/protected/);
    expectRuns(s, 'git diff ~/notes.md');
    expectRuns(s, 'git diff HEAD~1');
    expectRuns(s, 'git log HEAD~3..HEAD');
    expectRuns(s, 'git diff HEAD^ HEAD~2 -- src/a.ts');
  });
});

describe('R62: -L, which names a line range and a file in one word', () => {
  test.each(['git log -L:main:src/a.ts', 'git log -L5:src/a.ts', 'git log -nL5:src/a.ts', 'git log -pL:f:x', 'git log -L', 'git diff -L1'])('%s', (command) => {
    expect(whyNot(s, command)).toMatch(LINE_RANGE);
    // PowerShell 5.1 splits the unquoted word at its colon (R64), which it is refused for first when it has one
    expect(whyNot(s, command, { tool: 'PowerShell' })).toMatch(/names a line range|^PowerShell splits this option at the dot/);
  });
  test('with a range, in Bash (a comma is a list in PowerShell)', () => {
    expect(whyNot(s, 'git log -L1,5:.seam/state.json')).toMatch(/records|names a line range/); // the file in it is named, and protected
    expect(whyNot(s, 'git log -L1,5:src/a.ts')).toMatch(LINE_RANGE);
    expect(whyNot(s, 'git log -L1,5:src/a.ts', { tool: 'PowerShell' })).toMatch(/comma is not allowed/);
  });
  test('after a lone --, a word that looks like it is a path; other short options are fine', () => {
    expectRuns(s, 'git log -- -L');
    expectRuns(s, 'git log -n5 -p');
    expectRuns(s, 'git diff -U3 -w');
  });
});

describe('R62: the value stuck to a one-letter option is a path too', () => {
  test.each([
    ['-O.seam/state.json', /records/], ['-OCLAUDE.md', /protected/], ['-Osrc/../.seam/lock.json', /records/], ['-O~/.claude/settings.json', /protected/],
    ['-OCLAUDE.local.md', /protected/], ['-O.claude/x', /protected/], ['-Odocs/AGENTS.md', /protected/],
  ] as [string, RegExp][])('git diff %s', (word, reason) => {
    const refusal = whyNot(s, `git diff ${word}`);
    expect(refusal).toMatch(/^a command may not touch /);
    expect(refusal).toMatch(reason);
    // PowerShell 5.1 splits the unquoted word at its dot and the guard refuses it for that (R64); quoted, it is whole and path-checked
    expect(whyNot(s, `git diff ${word}`, { tool: 'PowerShell' })).toMatch(/^PowerShell splits this option at the dot/);
    expect(whyNot(s, `git diff '${word}'`, { tool: 'PowerShell' })).toMatch(reason);
  });
  test.each([
    ['-pO.claude/settings.json', /protected/], ['-pOCLAUDE.md', /protected/], ['-wO.seam/state.json', /records/], ['-pO~/.claude/settings.json', /protected/],
    ['-pOsrc/../.seam/lock.json', /records/], ['-nbO.claude/x', /protected/], ['-pO.seam/state.json', /records/],
  ] as [string, RegExp][])('a cluster, in Bash: git diff %s is -p, then -O with its file (R64)', (word, reason) => {
    const refusal = whyNot(s, `git diff ${word}`);
    expect(refusal).toMatch(/^a command may not touch /);
    expect(refusal).toMatch(reason);
  });
  test('and in a cluster the other letters are not files', () => {
    expectRuns(s, 'git diff -pU3');
    expectRuns(s, 'git diff -pw');
    expectRuns(s, 'git log -pn5');
    expectRuns(s, 'git diff -pOorder.txt');
  });
  test('the file stuck on in git log and git show too, and by its absolute path', () => {
    expect(whyNot(s, 'git log -O.seam/state.json')).toMatch(/records/);
    expect(whyNot(s, 'git show -O.seam/state.json')).toMatch(/records/);
    expect(whyNot(s, `git diff -O${join(s.app.root, '.seam', 'state.json')}`)).toMatch(/records/);
  });
  test('a file named apart from the option is checked as it was before', () => {
    expect(whyNot(s, 'git diff -O .seam/state.json')).toMatch(/records/);
    expect(whyNot(s, 'git diff --orderfile=.seam/state.json')).toMatch(/records/);
  });
  test('honest values and words that only look alike are fine', () => {
    expectRuns(s, 'git diff -Oorder.txt');
    expectRuns(s, 'git diff -O src/order.txt');
    expectRuns(s, 'git diff -U3 -w -b');
    expectRuns(s, 'git log -n5');
    expectRuns(s, 'git log -S"foo" -- src/a.ts');
    expectRuns(s, 'git branch -vv');
  });
});

describe('the sentences of the guard are spaced', () => {
  const GUARD = resolve(import.meta.dirname, '../../src/guard');
  test.each(readdirSync(GUARD).filter((name) => name.endsWith('.ts')))('%s has no constant written with its text stuck to the equals sign', (name) => {
    expect(readFileSync(join(GUARD, name), 'utf8')).not.toMatch(/export const \w+ =['"`]/);
  });
  test('and the one that was missing its space says what it says', () => {
    expect(readFileSync(join(GUARD, 'writewhy.ts'), 'utf8')).toMatch(/export const CONTRACTS_TS_ONLY = 'contracts hold TypeScript schemas only';/);
  });
});
