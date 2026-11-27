// decideCommand, part 1: what may run (rule 5), who may run it (rule 1), and the words the refusals use. Each
// case asks the decision directly. The cheats (test/cheats) run the real hook.
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { asBuilder, asChecker, asMain } from '../helpers/app.ts';
import type { Who } from '../helpers/app.ts';
import { commandScene, expectRuns, runs, whyNot } from '../helpers/command.ts';
import type { Scene } from '../helpers/decide.ts';
import { expectPlain } from '../helpers/calls.ts';

let s: Scene;
beforeAll(async () => {
  s = await commandScene();
});

const TOOLS = ['Bash', 'PowerShell'] as const;
const script = (): string => join(s.app.pluginRoot, 'dist', 'seam.mjs');

describe('rule 5: every command on the list runs, from either shell', () => {
  const ALLOWED = [
    'seam report', 'seam status', 'seam request freeze', 'seam init', 'seam init --app-root seam-app', 'seam install-shortcut', 'seam help',
    'git status', 'git status --short', 'git log', 'git log --oneline -5', 'git log --format=%h', 'git diff', 'git diff HEAD~1', 'git diff -- src/pricing/total.ts',
    'git show', 'git show HEAD', 'git show HEAD:src/pricing/total.ts', 'git diff --no-textconv --no-ext-diff', 'git log --output-indicator-new=+', 'git log -- --output=x', 'git diff --exit-code',
    'git branch', 'git branch -a', 'git branch -r', 'git branch -vv', 'git branch --list', 'git branch --contains HEAD',
    'git branch --show-current', 'git branch --sort=-committerdate',
    'npm test', 'npm run test', 'npm run typecheck', 'npx vitest run', 'npx vitest run test/unit/total.test.ts', 'npx vitest run test/unit test/cheats',
    'node --version', 'npm --version',
  ];
  describe.each(TOOLS)('%s', (tool) => {
    test.each(ALLOWED)('%s', (command) => expectRuns(s, command, { tool }));
  });

  test('the first word is matched whatever its letter case, and a quoted word is the word', () => {
    for (const command of ['SEAM report', 'Seam Report', 'GIT status', 'Git Log', 'NPM test', 'Npx vitest run', 'NODE --version', '"git" status', "'npm' test", 'g""it status']) {
      expectRuns(s, command);
    }
  });

  test('the plugin\'s own script, by its full path in either spelling', () => {
    expectRuns(s, `node "${script()}" report`);
    expectRuns(s, `node ${script().replace(/\\/g, '/')} status`);
    expectRuns(s, `node '${script().replace(/\\/g, '/')}' request freeze`, { tool: 'PowerShell' });
  });

  test('a relative path to it counts when it leads to it', () => {
    expectRuns(s, 'node dist/seam.mjs report', { cwd: s.app.pluginRoot });
    expectRuns(s, 'node ./dist/../dist/seam.mjs help', { cwd: s.app.pluginRoot });
  });

  test('run_in_background set to false is not a background run', () => {
    expectRuns(s, 'npm test', { extra: { run_in_background: false } });
  });
});

describe('rule 1: only the main AI runs commands', () => {
  const OTHERS: [string, Who][] = [
    ['a builder', asBuilder('builder-1')],
    ['a checker', asChecker()],
    ['a describer', { agent_id: 'd-1', agent_type: 'seam-v2:describer' }],
    ['a surveyor', { agent_id: 's-1', agent_type: 'seam-v2:surveyor' }],
    ['the design pass', { agent_id: 'x-1', agent_type: 'seam-v2:design' }],
    ["another plugin's agent", { agent_id: 'o-1', agent_type: 'other:helper' }],
    ['an agent with no type', { agent_id: 'n-1' }],
  ];
  describe.each(OTHERS)('%s', (_name, who) => {
    test.each(['npm test', 'git status', 'seam report', 'Set-Content x y'])('%s is refused', (command) => {
      expect(whyNot(s, command, { who })).toBe('only the main AI may run commands');
    });
  });
  test('the main AI is not refused for the same command', () => expectRuns(s, 'npm test', { who: asMain() }));
});

describe('a call that carries no command the guard can read is refused', () => {
  test.each([[{}], [{ command: undefined }], [{ command: 42 }], [{ command: null }], [{ command: ['npm', 'test'] }], [{ command: '' }], [{ command: '   ' }]])('%j', (toolInput) => {
    const d = runs(s, '', { extra: toolInput, tool: 'Bash' });
    // `runs` always sets `command` first, so the extra fields win
    expect(d).toEqual({ kind: 'deny', reason: "this call doesn't carry a command the guard can read" });
  });
});

describe('rule 6: everything else is refused, and the reason says what to do', () => {
  const said = (command: string): string => whyNot(s, command);
  test('it names the first words and the commands that are on the list', () => {
    expect(said('git commit -m x')).toMatch(/^'git commit' isn't on seam's command list; use the seam commands \(seam report, seam status/);
    expect(said('Set-Content src/x.ts x')).toMatch(/^'Set-Content' isn't on seam's command list; use the seam commands/);
    expect(said('ls')).toMatch(/^'ls' isn't on seam's command list/);
  });
  test('and a hint for the common needs', () => {
    expect(said('Set-Content src/x.ts hello')).toMatch(/Edit and Write tools/);
    expect(said('rm -rf build')).toMatch(/Edit and Write tools/);
    expect(said('cat src/x.ts')).toMatch(/Read, Glob and Grep/);
    expect(said('git commit -m x')).toMatch(/stage 2 as `seam commit`/);
    expect(said('git push')).toMatch(/stage 2 as `seam commit`/);
    expect(said('npm install left-pad')).toMatch(/stage 2 as `seam add`/);
    expect(said('pnpm add x')).toMatch(/stage 2 as `seam add`/);
    expect(said('powershell -c x')).toMatch(/another shell or run code/);
  });
  test('a refusal is plain words', () => {
    for (const command of ['git commit', 'npm i', 'Remove-Item x', 'seam bogus', 'npm test & echo', 'node -e 1']) expectPlain(whyNot(s, command));
  });
});
