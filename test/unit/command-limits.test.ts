// R60: wildcards in a command's words, `ref:path` read from the top of the repository, background words only where a
// command starts, instruction files with .local, and the cap of 200 words.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { decideCommand } from '../../src/guard/command.ts';
import { commandScene, expectRuns, runs, whyNot } from '../helpers/command.ts';
import type { Scene } from '../helpers/decide.ts';
import { project, tempDir } from '../helpers/project.ts';

let s: Scene;
beforeAll(async () => {
  s = await commandScene();
});

const WILDCARD = "wildcards (* ? [) are not allowed in a command's words; name the file or folder itself";
const TOOLS = ['Bash', 'PowerShell'] as const;

describe('R60: no wildcard in the words of a command', () => {
  test.each([
    'git log -p -- .se?m', "git log -p -- '.se*'", 'git diff CLAUDE.m?', 'git show HEAD:.cl?ude/settings.json', 'git diff -- .se[a]m/state.json', 'git log -- *',
    'git diff [c]laude.md', 'git status .s*m', 'git log -- ".se?m/state.json"', 'npx vitest run test/*.test.ts', 'seam request freeze?', 'git log --grep=a*b',
    'git branch --contains "feat*"', 'git show HEAD:.seam/sta*e.json', 'git diff --stat=?', 'git log -- .sea[m]',
  ])('%s', (command) => {
    for (const tool of TOOLS) expect(whyNot(s, command, { tool }), tool).toBe(WILDCARD);
  });
  test('a command with none is not refused for it', () => {
    expectRuns(s, 'git log --format=%h -n 5 -- src/pricing/total.ts');
  });
  test('it is the allowed commands that are told about wildcards; a refused one is told what it is', () => {
    expect(whyNot(s, 'rm *.ts')).toMatch(/isn't on seam's command list/);
  });
});

describe('R60: a ref:path is read from the top of the repository, and ref:./path from the folder the command runs in', () => {
  const src = (): string => join(s.app.root, 'src');
  const refused = (command: string, cwd: string): string => whyNot(s, command, { cwd });

  test('from a subfolder, git show HEAD:.seam/state.json is still the project records', () => {
    expect(refused('git show HEAD:.seam/state.json', src())).toMatch(/may not touch .*records/);
    expect(refused('git show HEAD:.seam/lock.json', join(src(), 'pricing'))).toMatch(/records/);
    expect(refused('git show origin/main:CLAUDE.md', src())).toMatch(/protected/);
    expect(refused('git diff HEAD~1:.claude/settings.json', src())).toMatch(/protected/);
    expect(refused('git show :.seam/state.json', src())).toMatch(/records/);
    expect(refused('git show HEAD:docs/CLAUDE.local.md', src())).toMatch(/protected/);
  });
  test('and the same from the top', () => {
    expect(refused('git show HEAD:.seam/state.json', s.app.root)).toMatch(/records/);
  });
  test('ref:./path and ref:../path are from the folder the command runs in', () => {
    expect(refused('git show HEAD:./.seam/state.json', s.app.root)).toMatch(/records/);
    expect(refused('git show HEAD:../.seam/state.json', src())).toMatch(/records/);
    expectRuns(s, 'git show HEAD:./.seam/state.json', { cwd: src() }); // src/.seam/state.json is nothing
    expectRuns(s, 'git show HEAD:./pricing/total.ts', { cwd: src() });
  });
  test('an honest ref:path is allowed from anywhere in the project', () => {
    expectRuns(s, 'git show HEAD:src/pricing/total.ts', { cwd: src() });
    expectRuns(s, 'git show HEAD:package.json', { cwd: src() });
    expectRuns(s, 'git diff main:src/pricing/total.ts', { cwd: join(src(), 'pricing') });
  });
  test('a path with no ref is from the folder the command runs in, as before', () => {
    expectRuns(s, 'git diff .seam/state.json', { cwd: src() }); // src/.seam/state.json is nothing
    expect(refused('git diff ../.seam/state.json', src())).toMatch(/records/);
  });

  test('a project inside a bigger repository: the top is the bigger repository, so its path starts with the project folder', () => {
    const outer = tempDir();
    execFileSync('git', ['init', '-q'], { cwd: outer });
    const p = project({}, false, join(outer, 'sub'));
    const ask = (command: string, cwd: string) => decideCommand({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command } }, p.ctx);
    const refusal = (cwd: string, command: string): string => {
      const d = ask(command, cwd);
      expect(d.kind, command).toBe('deny');
      return d.kind === 'deny' ? d.reason : '';
    };
    expect(refusal(p.root, 'git show HEAD:sub/.seam/state.json')).toMatch(/records/); // from the top of the outer repository
    expect(refusal(p.root, 'git show HEAD:.seam/state.json')).toMatch(/records/); // from the project's root
    expect(refusal(join(p.root, 'src'), 'git show HEAD:sub/CLAUDE.md')).toMatch(/protected/);
    expect(ask('git show HEAD:README.md', p.root)).toEqual({ kind: 'allow' });
  });
});

describe('R60: a background word is one only where a command starts', () => {
  test.each([
    'npx vitest run test/disown.test.ts', 'npx vitest run test/nohup.test.ts test/setsid.test.ts', 'git log --grep=nohup', 'git log --grep=Start-Process',
    'git diff -- src/saps.ts', 'git log -- docs/start-job.md', 'git show HEAD:docs/Start-ThreadJob.md', 'seam request disown',
  ])('%s is allowed', (command) => {
    for (const tool of TOOLS) expectRuns(s, command, { tool });
  });
  test.each([
    'nohup node x', 'NOHUP node x', 'Start-Process node', 'start-process node', 'saps node', 'Start-Job node', 'sajb node', 'Start-ThreadJob node', 'setsid node x', 'disown',
    '"nohup" node x', "'Start-Process' node",
  ])('%s as the command is a background run', (command) => {
    for (const tool of TOOLS) expect(whyNot(s, command, { tool }), tool).toBe("background runs aren't allowed");
  });
  test('after a separator too, so the better reason is said', () => {
    expect(whyNot(s, 'npm run typecheck; nohup node x')).toBe("background runs aren't allowed");
    expect(whyNot(s, 'git status && Start-Process node')).toBe("background runs aren't allowed");
  });
  test('and the spellings that mean it anywhere still do', () => {
    for (const command of ['cmd /c start /b node x', 'powershell -WindowStyle Hidden -File x', 'npm test &', 'git log&']) {
      expect(whyNot(s, command), command).toBe("background runs aren't allowed");
    }
  });
});

describe('R60: the instruction files with .local are protected for a command too', () => {
  test.each(['CLAUDE.local.md', 'docs/CLAUDE.local.md', 'src/AGENTS.local.md', 'AGENTS.project.md'])('git diff %s', (path) => {
    expect(whyNot(s, `git diff ${path}`)).toMatch(/protected/);
  });
});

describe('R60: a command is checked up to 200 words', () => {
  const words = (n: number): string => ['git', 'log', '--', ...Array.from({ length: n - 3 }, (_, i) => `tests/f${i}.ts`)].join(' ');
  test('200 words is checked, and allowed when it is honest', () => {
    expect(words(200).split(' ')).toHaveLength(200);
    expectRuns(s, words(200));
  });
  test('201 words is refused, and says why', () => {
    expect(words(201).split(' ')).toHaveLength(201);
    expect(whyNot(s, words(201))).toBe('this command is too long for the guard to check (over 200 words)');
    expect(whyNot(s, words(2000), { tool: 'PowerShell' })).toBe('this command is too long for the guard to check (over 200 words)');
  });
  test('the cap is on words, not on letters', () => {
    expectRuns(s, `git log --grep=${'a'.repeat(300)}`);
  });
  test('a long command that chains is told it chains', () => {
    expect(whyNot(s, `${words(300)}; rm x`)).toMatch(/^one simple command at a time/);
  });
  test('runs() is not fooled by the cap: a short command after a long one is fine', () => {
    expect(runs(s, 'git status')).toEqual({ kind: 'allow' });
  });
});
