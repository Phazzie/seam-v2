// decideCommand rule 4 and R20: a command may not name a protected place, in any way it can be spelled. A path is
// read every way a shell could read it (MSYS, Cygwin and WSL drive forms, `~`, backslash escapes) and the stricter
// reading wins. The seam command's own script is the one path in the plugin a command may name.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { commandScene, expectRuns, whyNot } from '../helpers/command.ts';
import type { Scene } from '../helpers/decide.ts';

let s: Scene;
beforeAll(async () => {
  s = await commandScene();
});

const WIN = process.platform === 'win32';
const TOOLS = ['Bash', 'PowerShell'] as const;
const TOUCH = /^a command may not touch /;
/** `C:\a\b` as `/c/a/b`, `/cygdrive/c/a/b` or `/mnt/c/a/b`. */
const unixy = (abs: string, prefix: string): string => `${prefix}${abs[0].toLowerCase()}${abs.slice(2).replace(/\\/g, '/')}`;
const FORMS = ['/', '/cygdrive/', '/mnt/'];

describe('a protected place named by an allowed command is refused, whatever the command', () => {
  const PLACES: [string, () => string, RegExp][] = [
    ['the state file', () => '.seam/state.json', /records.*scripts/],
    ['the .seam folder', () => '.seam', /records/],
    ['a file in .seam by its absolute path', () => join(s.app.root, '.seam', 'lock.json'), /records/],
    ['whatever the letter case', () => '.SEAM/State.JSON', /records/],
    ['with backslashes', () => '.seam\\state.json', /records/],
    ['through ..', () => 'src/../.seam/state.json', /records/],
    ['with a backslash read as an escape', () => '.se\\am/state.json', /records/],
    ['in .claude', () => '.claude/settings.json', /protected/],
    ['CLAUDE.md', () => 'CLAUDE.md', /protected/],
    ['an AGENTS.md in a folder (R54)', () => 'src/deep/AGENTS.md', /protected/],
    ['an AGENTS.project.md in a folder (R54)', () => 'docs/AGENTS.project.md', /protected/],
    ["the plugin's files", () => join(s.app.pluginRoot, 'dist', 'hook.mjs'), /plugin's own files/],
    ["the plugin's data folder", () => join(s.app.dataDir, 'projects.json'), /data folder/],
    ["the owner's Claude settings", () => join(homedir(), '.claude', 'settings.json'), /protected/],
    ["the owner's Claude settings by ~", () => '~/.claude/settings.json', /protected/],
    ["the owner's Claude plugins by ~ and backslashes", () => '~\\.claude\\plugins\\x', /protected/],
    ['a file ref in git', () => 'HEAD:.seam/lock.json', /records/],
    ['an option value', () => '--output=.seam/x', /records/],
  ];
  describe.each(TOOLS)('%s', (tool) => {
    test.each(PLACES)('git diff -- %s', (_what, path, reason) => {
      const refusal = whyNot(s, `git diff -- ${path()}`, { tool });
      expect(refusal).toMatch(TOUCH);
      expect(refusal).toMatch(reason);
    });
  });

  test('a PowerShell-style parameter value is a path (Bash; PowerShell 5.1 would split the word at its colon, R64)', () => {
    expect(whyNot(s, 'git diff -- -Path:.seam/x')).toMatch(/records/);
    expect(whyNot(s, 'git diff -- -Path:.seam/x', { tool: 'PowerShell' })).toMatch(/^PowerShell splits this option at the dot/);
    expect(whyNot(s, "git diff -- '-Path:.seam/x'", { tool: 'PowerShell' })).toMatch(/records/);
  });

  test('with the quotes taken off (Bash: PowerShell 5.1 refuses a quote inside a word, R61)', () => {
    expect(whyNot(s, "git diff -- .se''am/state.json")).toMatch(/records/);
    expect(whyNot(s, 'git diff -- ".se""am"/state.json')).toMatch(/records/);
    expect(whyNot(s, 'git diff -- ".seam"/state.json')).toMatch(/records/);
    expect(whyNot(s, 'git diff -- ".seam/state.json"')).toMatch(/records/);
    expect(whyNot(s, 'git diff -- ".seam/state.json"', { tool: 'PowerShell' })).toMatch(/records/);
  });

  test('the command does not matter, and neither does where in it the path is', () => {
    expect(whyNot(s, 'Remove-Item .seam -Recurse -Force', { tool: 'PowerShell' })).toMatch(/records|scripts/);
    expect(whyNot(s, 'npx vitest run .seam/x')).toMatch(/records/);
    expect(whyNot(s, 'seam init --app-root .claude')).toMatch(/protected/);
    expect(whyNot(s, 'seam init --app-root=.claude')).toMatch(/protected/);
    expect(whyNot(s, 'git log CLAUDE.md')).toMatch(/protected/);
    expect(whyNot(s, 'git log -5 CLAUDE.md')).toMatch(/protected/);
  });

  test('a refused command that names a protected place says so before it says the command is not on the list', () => {
    expect(whyNot(s, 'Get-Content .seam/state.json')).toMatch(/records/);
  });

  test('other places are not off limits to an allowed command: code, tests, config, notes, outside the project', () => {
    for (const path of ['src/pricing/total.ts', 'tests/total.test.ts', 'package.json', 'README.md', 'notes.md', 'plan/plan.json', 'HEAD', 'HEAD~1', 'main..HEAD', join(s.app.dataDir, '..', 'elsewhere.txt')]) {
      expectRuns(s, `git diff -- ${path}`);
    }
  });
});

describe('R20: MSYS, Cygwin and WSL spellings are read as the drive paths they stand for', () => {
  const ON_WINDOWS = test.runIf(WIN);
  const PROTECTED: [string, () => string, RegExp][] = [
    ['the state file', () => join(s.app.root, '.seam', 'state.json'), /records/],
    ['CLAUDE.md', () => join(s.app.root, 'CLAUDE.md'), /protected/],
    ["the plugin's script", () => join(s.app.pluginRoot, 'dist', 'hook.mjs'), /plugin's own files/],
    ["the plugin's data folder", () => join(s.app.dataDir, 'projects.json'), /data folder/],
  ];
  describe.each(FORMS)('%s', (prefix) => {
    describe.each(PROTECTED)('%s', (_what, abs, reason) => {
      ON_WINDOWS.each(TOOLS)('%s: git diff', (tool) => {
        const refusal = whyNot(s, `git diff -- ${unixy(abs(), prefix)}`, { tool });
        expect(refusal).toMatch(TOUCH);
        expect(refusal).toMatch(reason);
      });
    });
  });
  ON_WINDOWS('the drive letter may be upper case', () => {
    const abs = join(s.app.root, '.seam', 'state.json');
    expect(whyNot(s, `git diff -- /${abs[0].toUpperCase()}${abs.slice(2).replace(/\\/g, '/')}`)).toMatch(/records/);
  });
  ON_WINDOWS('a command that is not on the list is told about the path first', () => {
    expect(whyNot(s, `Remove-Item -Recurse ${unixy(join(s.app.root, '.seam'), '/mnt/')}`, { tool: 'PowerShell' })).toMatch(/records/);
  });
  ON_WINDOWS('a path that only looks like a drive form, to nowhere protected, is not refused', () => {
    expectRuns(s, 'git diff -- /c/no/such/place/x.txt');
    expectRuns(s, 'git diff -- /mnt/c/no/such/place/x.txt');
    expectRuns(s, 'git diff -- /d/x /e/y');
  });
  ON_WINDOWS('the plugin script by an MSYS spelling is not allowed as the script: PowerShell would read that path as it is, so the guard does not guess', () => {
    const abs = join(s.app.pluginRoot, 'dist', 'seam.mjs');
    expect(whyNot(s, `node ${unixy(abs, '/')} report`)).toMatch(/plugin's own files/);
    expect(whyNot(s, `node ${unixy(abs, '/')} report`, { tool: 'PowerShell' })).toMatch(/plugin's own files/);
  });
});

describe('the seam command\'s own script is the one plugin path a command may name', () => {
  const script = (): string => join(s.app.pluginRoot, 'dist', 'seam.mjs');
  test('but nothing else in the plugin, and not as an argument', () => {
    expectRuns(s, `node "${script()}" report`);
    expect(whyNot(s, `node "${script()}" report ${join(s.app.pluginRoot, 'dist', 'hook.mjs')}`)).toMatch(TOUCH);
    expect(whyNot(s, `git diff ${script()}`)).toMatch(/plugin's own files/);
    expect(whyNot(s, `node ${join(s.app.pluginRoot, 'dist', 'hook.mjs')} report`)).toMatch(/plugin's own files/);
  });
});
