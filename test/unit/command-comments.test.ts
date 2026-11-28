// R76 (Codex on PR #22): two ways a command could say one thing to the guard and another to the shell.
//  - A word that starts with `#` begins a comment in Bash and PowerShell: `git branch injected # --list` is read by the scanner
//    as ending in `--list`, but the shell runs `git branch injected`, which makes a branch. Such a word is refused.
//  - `git branch` was checked word by word, so a value an option consumes (`--format x`, `--sort x`) was read as a branch name
//    or, the other way round, a real name next to one was missed. The values an option takes are consumed, and any word left
//    over is a branch name to make or rename, and is refused.
// What git really does with these was tried in a scratch repository: --format and --sort take their value as the next word
// (a word after it makes a branch); --column, --color and --abbrev take one only with `=` (a word after them makes a branch).
import { beforeAll, describe, expect, test } from 'vitest';
import { commandScene, expectRuns, runs, whyNot } from '../helpers/command.ts';
import type { Scene } from '../helpers/decide.ts';

let s: Scene;
beforeAll(async () => {
  s = await commandScene();
});

const TOOLS = ['Bash', 'PowerShell'] as const;
const COMMENTS = /^comments aren't allowed in commands/;
const LISTS_ONLY = /'git branch[^']*' isn't allowed here: git branch only lists branches/;

describe('a comment is refused, in either shell', () => {
  describe.each(TOOLS)('%s', (tool) => {
    test.each([
      'git branch injected # --list', 'git status #x', '# git status', 'git log -1 # note', 'git log\t#x', 'npm test #', 'seam report # hello',
      "git branch injected '' # --list",
    ])('%j', (command) => expect(whyNot(s, command, { tool })).toMatch(COMMENTS));
  });

  test('the comment is refused before the command is judged (so what the shell would run is never guessed at)', () => {
    expect(whyNot(s, 'git branch injected # --list')).toMatch(COMMENTS);
    expect(whyNot(s, 'rm -rf x # y')).toMatch(COMMENTS);
  });

  const NOT_COMMENTS = [
    "git log --grep '#12'", 'git log --grep "#13"', "git log --grep 'a #b'", 'git log --grep=#12', 'git show HEAD#x', 'git log --format=%h#',
  ];
  test.each(NOT_COMMENTS)('Bash: a # that does not start a word is only a character: %s', (command) => expectRuns(s, command));
  test.each(NOT_COMMENTS)('PowerShell: the comment rule does not refuse it: %s', (command) => {
    const d = runs(s, command, { tool: 'PowerShell' });
    if (d.kind === 'deny') expect(d.reason).not.toMatch(/comments aren't allowed/); // another PowerShell rule may (a space in a word, a %)
  });
});

describe('git branch: the values an option takes are consumed, and any word left over is refused', () => {
  const RUNS = [
    'git branch', 'git branch -a', 'git branch -r', 'git branch -vv', 'git branch --list', 'git branch --show-current', 'git branch --sort=-committerdate',
    'git branch --contains HEAD', 'git branch --contains', 'git branch --no-contains HEAD', 'git branch --merged HEAD', 'git branch --merged', 'git branch --no-merged HEAD',
    'git branch --points-at HEAD', 'git branch --format short', 'git branch --format=short', 'git branch --sort refname', 'git branch --sort -committerdate',
    'git branch --column', 'git branch --column=always', 'git branch --color', 'git branch --color=never', 'git branch --abbrev=8', 'git branch --no-abbrev',
    'git branch -a --contains HEAD --sort refname', 'git branch --contains=HEAD', 'git branch --contains --',
  ];
  describe.each(TOOLS)('%s: allowed', (tool) => {
    test.each(RUNS)('%s', (command) => expectRuns(s, command, { tool }));
  });

  describe.each(TOOLS)('%s: refused', (tool) => {
    test.each([
      'git branch injected --contains HEAD', 'git branch --contains HEAD injected', 'git branch --list injected', 'git branch --list main',
      'git branch --format refname injected', 'git branch --sort refname injected', 'git branch --column injected', 'git branch --color injected',
      'git branch --abbrev injected', 'git branch --merged HEAD injected', 'git branch --points-at HEAD injected', 'git branch -a injected', 'git branch -vv injected',
      'git branch --contains=HEAD injected', 'git branch injected', 'git branch injected HEAD', 'git branch --show-current injected', 'git branch -- injected',
      'git branch --format x -- injected',
    ])('%s', (command) => expect(whyNot(s, command, { tool })).toMatch(LISTS_ONLY));

    test.each(['git branch --set-upstream-to=x', 'git branch -u x', 'git branch -d x', 'git branch --contains HEAD --delete', 'git branch --sort refname -D'])(
      'an option that is not for listing is still refused whatever else is there: %s',
      (command) => expect(whyNot(s, command, { tool })).toMatch(LISTS_ONLY),
    );
  });

  test('a value that looks like an option is still the option\'s value, and does not hide a word after it', () => {
    expect(whyNot(s, 'git branch --sort -committerdate injected')).toMatch(LISTS_ONLY);
    expectRuns(s, 'git branch --sort -committerdate');
  });

  test('the value an option takes is not a word the guard must not read: a protected path is still refused', () => {
    expect(whyNot(s, 'git branch --format .seam/state.json')).toMatch(/may not touch/);
  });

  test('abbreviated long options are still refused (git takes any start of one)', () => {
    expect(whyNot(s, 'git branch --cont HEAD')).toMatch(LISTS_ONLY);
    expect(whyNot(s, 'git branch --li')).toMatch(LISTS_ONLY);
  });
});
