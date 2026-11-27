// commandTargets (R41, with R20's drive forms): the paths and folders a shell command mentions, read from the text
// alone. The hook's project lookup and the worker's cheap check both use it through targetsOf, so a command run from
// a folder that is not a seam project is judged by the project it changes into or names. Also the scanner under it.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { commandTargets as exportedByCommand } from '../../src/guard/command.ts';
import { commandTargets, isPathLike, pathParts, pathText, readingsOf, scan, unescaped } from '../../src/guard/commandtext.ts';
import { targetsOf } from '../../src/guard/request.ts';

test('command.ts exports commandTargets too (it is the same function)', () => expect(exportedByCommand).toBe(commandTargets));

describe('scan: the words of a command', () => {
  test('words, and one list per simple command', () => {
    expect(scan('git log --oneline').segments).toEqual([['git', 'log', '--oneline']]);
    expect(scan('a b; c && d | e > f\ng').segments).toEqual([['a', 'b'], ['c'], ['d'], ['e'], ['f'], ['g']]);
    expect(scan('  a \t b ').segments).toEqual([['a', 'b']]);
    expect(scan('').segments).toEqual([]);
  });
  test('quotes group words and are dropped, and join what is next to them', () => {
    expect(scan('cd "C:\\My Projects\\app"').segments).toEqual([['cd', 'C:\\My Projects\\app']]);
    expect(scan("git log --grep='a b'").segments).toEqual([['git', 'log', '--grep=a b']]);
    expect(scan(".se''am/x").segments).toEqual([['.seam/x']]);
    expect(scan('g""it').segments).toEqual([['git']]);
    expect(scan('echo ""').segments).toEqual([['echo', '']]);
    expect(scan('a "b ; c" d').segments).toEqual([['a', 'b ; c', 'd']]);
    expect(scan(`a "it's" b`).segments).toEqual([['a', "it's", 'b']]);
  });
  test('it says when a quote is never closed', () => {
    expect(scan('git log "abc').closed).toBe(false);
    expect(scan("git log 'abc").closed).toBe(false);
    expect(scan('git log "abc"').closed).toBe(true);
  });
  test('blind, a quote only ends a word, so what is inside is read as the shell runs it', () => {
    expect(scan('echo "$(cd /proj)"', true).segments).toEqual([['echo', '$'], ['cd', '/proj']]);
  });
});

describe('pathParts (R60): a path, and whether a git ref was in front of it', () => {
  test.each([
    ['HEAD:src/a.ts', 'src/a.ts', true], ['origin/main:CLAUDE.md', 'CLAUDE.md', true], [':.seam/state.json', '.seam/state.json', true], ['HEAD~1:a/b', 'a/b', true],
    ['HEAD:./x', './x', true], ['--format=%h:%s', '%s', true],
    ['src/a.ts', 'src/a.ts', false], ['C:\\x\\y', 'C:\\x\\y', false], ['-Path:C:\\x', 'C:\\x', false], ['--output=.seam/x', '.seam/x', false], ['status', 'status', false],
  ])('%s', (word, text, ref) => expect(pathParts(word)).toEqual({ text, ref }));
  test('a ref cannot hold a colon, so the path starts after the first one', () => {
    expect(pathParts('HEAD:a:b')).toEqual({ text: 'a:b', ref: true });
  });
  test('and nothing where pathText gives nothing', () => {
    for (const word of ['--oneline', 'https://x.y/z', '/c', '', 'HEAD:']) expect(pathParts(word)).toBeNull();
  });
});

describe('unescaped: a word once the backslash escapes are taken out', () => {
  test.each([['--out\\put', '--output'], ['a\\ b', 'a b'], ['\\--x', '--x'], ['C:\\a\\b', 'C:ab'], ['plain', 'plain'], ['a\\', 'a\\']])('%s is %s', (word, plain) => {
    expect(unescaped(word)).toBe(plain);
  });
});

describe('pathText and isPathLike', () => {
  test.each([
    ['src/a.ts', 'src/a.ts'], ['C:\\x\\y', 'C:\\x\\y'], ['--output=/proj/y', '/proj/y'], ['-Path:C:\\x', 'C:\\x'], ['--root=x', 'x'], ['HEAD:src/a.ts', 'src/a.ts'],
    ['origin/main:CLAUDE.md', 'CLAUDE.md'], ['status', 'status'], ['.', '.'],
  ])('%s is %s', (word, text) => expect(pathText(word)).toBe(text));
  test.each(['--oneline', '-5', '-', '--', 'https://example.com/a', 'ftp://x/y', '/', '//', '\\', '/c', '/b', '/?', '-Path', ''])('%j is not a path', (word) => {
    expect(pathText(word)).toBeNull();
  });
  test.each(['src/a.ts', 'a\\b', '.seam', '..', '~', '~/x', 'C:\\x', 'C:/x', '/c/x', './a'])('%s looks like one', (text) => expect(isPathLike(text)).toBe(true));
  test.each(['status', 'report', 'HEAD', 'freeze', 'a.ts', 'total', 'C:', 'a:', 'x:'])('%s does not', (text) => expect(isPathLike(text)).toBe(false));
});

describe('readingsOf: every way a shell could read a path', () => {
  test('as written, and with backslashes as escapes unless it is a drive path', () => {
    expect(readingsOf('src/a.ts')).toEqual(['src/a.ts']);
    expect(readingsOf('.se\\am/x').sort()).toEqual(['.se\\am/x', '.seam/x'].sort());
    expect(readingsOf('C:\\a\\b')).toEqual(['C:\\a\\b']);
  });
  test('MSYS, Cygwin and WSL drive forms are also the drive path (R20)', () => {
    expect(readingsOf('/c/Users/x')).toEqual(['/c/Users/x', 'C:/Users/x']);
    expect(readingsOf('/cygdrive/d/a/b')).toEqual(['/cygdrive/d/a/b', 'D:/a/b']);
    expect(readingsOf('/mnt/c/a')).toEqual(['/mnt/c/a', 'C:/a']);
    expect(readingsOf('/MNT/C')).toEqual(['/MNT/C', 'C:/']);
    expect(readingsOf('/C/x')).toEqual(['/C/x', 'C:/x']);
  });
  test('but only for a drive: not a bare /c, a longer name, or a path that merely starts with /c', () => {
    expect(readingsOf('/c')).toEqual(['/c']);
    expect(readingsOf('/cx/a')).toEqual(['/cx/a']);
    expect(readingsOf('/mnt/cx/a')).toEqual(['/mnt/cx/a']);
    expect(readingsOf('/mnt')).toEqual(['/mnt']);
    expect(readingsOf('/usr/c/a')).toEqual(['/usr/c/a']);
  });
  test('~ is the home folder', () => {
    expect(readingsOf('~/.claude/x')).toContain(join(homedir(), '.claude/x'));
    expect(readingsOf('~')).toContain(homedir());
    expect(readingsOf('~x/y')).toEqual(['~x/y']);
  });
});

const cmd = (command: string): string[] => commandTargets(command);

describe('commandTargets: what a command names', () => {
  test('nothing, for the commands on the list and the words in them', () => {
    for (const command of ['git status', 'git log --oneline -5', 'seam report', 'npm test', 'npm run typecheck', 'npx vitest run', 'node --version', 'git show HEAD', 'seam request freeze']) {
      expect(cmd(command), command).toEqual([]);
    }
  });
  test('a path anywhere in it, as written', () => {
    expect(cmd('git diff src/a.ts')).toEqual(['src/a.ts']);
    expect(cmd('git diff HEAD~1 -- ./a.ts ../b.ts')).toEqual(['./a.ts', '../b.ts']);
    expect(cmd('npx vitest run test/unit/x.test.ts')).toEqual(['test/unit/x.test.ts']);
    expect(cmd('Remove-Item C:\\proj\\.seam -Recurse')).toEqual(['C:\\proj\\.seam']);
    expect(cmd('type .seam')).toEqual(['.seam']);
  });
  test('an option\'s value, a git ref\'s path, and a path in quotes with spaces', () => {
    expect(cmd('git log --output=/proj/y')).toEqual(['/proj/y']);
    expect(cmd('Set-Content -Path:C:\\x\\y z')).toEqual(['C:\\x\\y']);
    expect(cmd('git show HEAD:src/a.ts')).toEqual(['src/a.ts']);
    expect(cmd('git -C /proj status')).toEqual(['/proj']);
    expect(cmd('npm --prefix=/proj test')).toEqual(['/proj']);
    expect(cmd('cd "C:\\My Projects\\app"')).toContain('C:\\My Projects\\app');
  });
  test('the folder a cd, pushd or Set-Location goes to, even when it is a bare name', () => {
    expect(cmd('cd proj')).toEqual(['proj']);
    expect(cmd('CD proj')).toEqual(['proj']);
    expect(cmd('cd -P proj')).toEqual(['proj']);
    expect(cmd('pushd proj')).toEqual(['proj']);
    expect(cmd('Set-Location proj')).toEqual(['proj']);
    expect(cmd('Set-Location -Path proj')).toEqual(['proj']);
    expect(cmd('Set-Location -LiteralPath:proj')).toEqual(['proj']);
    expect(cmd('sl proj')).toEqual(['proj']);
    expect(cmd('Push-Location proj')).toEqual(['proj']);
    expect(cmd('chdir proj')).toEqual(['proj']);
    expect(cmd('cd ..')).toEqual(['..']);
    expect(cmd('cd c:')).toEqual(['c:']); // a drive alone is a folder after cd, and nothing without it
    expect(cmd('git log --grep a: b: x:')).toEqual([]);
  });
  test('and after any separator, in a group or in a subshell, quoted or not', () => {
    expect(cmd('echo hi; cd proj; rm x')).toContain('proj');
    expect(cmd('echo hi && cd proj')).toContain('proj');
    expect(cmd('echo hi | cd proj')).toContain('proj');
    expect(cmd('(cd proj; ls)')).toContain('proj');
    expect(cmd('{ cd proj }')).toContain('proj');
    expect(cmd('echo $(cd /proj)')).toContain('/proj');
    expect(cmd('echo "$(cd /proj)"')).toContain('/proj');
    expect(cmd('echo `cd /proj`')).toContain('/proj');
    expect(cmd('echo hi\ncd proj')).toContain('proj');
    expect(cmd('echo x > /proj/y')).toContain('/proj/y');
    expect(cmd('cat < /proj/y')).toContain('/proj/y');
    expect(cmd('echo x >/proj/y')).toContain('/proj/y');
  });
  test('only the first word after a cd is the folder; a word after the cd that is a path is one too', () => {
    expect(cmd('cd proj other')).toEqual(['proj']);
    expect(cmd('cd proj ./other')).toEqual(['proj', './other']);
  });
  test('MSYS, Cygwin and WSL drive forms come with their drive path (R20)', () => {
    expect(cmd('cd /c/proj')).toEqual(['/c/proj', 'C:/proj']);
    expect(cmd('git diff /mnt/d/x/y.ts')).toEqual(['/mnt/d/x/y.ts', 'D:/x/y.ts']);
    expect(cmd('ls /cygdrive/c/proj')).toEqual(['/cygdrive/c/proj', 'C:/proj']);
  });
  test('~ comes with the home folder, and a backslash escape with what it spells', () => {
    expect(cmd('cat ~/.claude/settings.json')).toContain(join(homedir(), '.claude/settings.json'));
    expect(cmd('git diff .se\\am/x')).toContain('.seam/x');
  });
  test('not web addresses, cmd switches, git refs without a path, or plain words', () => {
    expect(cmd('curl https://example.com/a/b')).toEqual([]);
    expect(cmd('cmd /c dir')).toEqual([]);
    expect(cmd('git log main..HEAD')).toEqual([]);
    expect(cmd('git log --grep "fix: login"')).toEqual([]);
    expect(cmd('git log --grep "Inputs: a: number, b: number"')).toEqual([]); // no colon is left in a path to be taken for a hidden stream
    expect(cmd("cat > x <<'EOF'\nPurpose: add a: b: c\nEOF").every((target) => !/^[^:]*:.*:/.test(target))).toBe(true);
  });
  test('the same path once', () => {
    expect(cmd('git diff a/b a/b')).toEqual(['a/b']);
  });
});

describe('targetsOf adds them for the shell tools and for no other tool', () => {
  const input = (tool: string, toolInput: Record<string, unknown>) => ({ hook_event_name: 'PreToolUse', tool_name: tool, cwd: '/x', tool_input: toolInput });
  test('Bash and PowerShell', () => {
    expect(targetsOf(input('Bash', { command: 'cd /c/proj' }))).toEqual(['/c/proj', 'C:/proj']);
    expect(targetsOf(input('PowerShell', { command: 'cd proj' }))).toEqual(['proj']);
  });
  test('the path fields still come first, and a Write that has a command field is not a shell', () => {
    expect(targetsOf(input('Bash', { command: 'cd proj', file_path: 'f.ts' }))).toEqual(['f.ts', 'proj']);
    expect(targetsOf(input('Write', { file_path: 'f.ts', command: 'cd proj' }))).toEqual(['f.ts']);
    expect(targetsOf(input('Read', { command: 'cd proj' }))).toEqual([]);
  });
  test('a command that is not text names nothing', () => {
    expect(targetsOf(input('Bash', { command: 42 }))).toEqual([]);
    expect(targetsOf(input('Bash', {}))).toEqual([]);
  });
});
