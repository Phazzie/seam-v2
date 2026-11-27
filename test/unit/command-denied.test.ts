// decideCommand, part 2: the forms that are never allowed. Rule 2 (one simple command), rule 3 (background runs),
// rule 4 (approving, skipping hooks), and the programs that are on the list but used in a way that is not.
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { commandScene, expectRuns, whyNot } from '../helpers/command.ts';
import type { Scene } from '../helpers/decide.ts';

let s: Scene;
beforeAll(async () => {
  s = await commandScene();
});

const TOOLS = ['Bash', 'PowerShell'] as const;
const ONE_AT_A_TIME = /^one simple command at a time, please/;

describe('rule 2: one simple command, no chaining, redirection or substitution', () => {
  const CHAINED = [
    'npm test & echo', 'npm test && echo hi', 'npm test; echo hi', 'npm test || echo hi', 'git log | head', 'git log > out.txt', 'git log >> out.txt',
    'git log 2> err.txt', 'npm test < in.txt', 'npm test `echo hi`', 'git log $(echo hi)', 'git log ${HOME}', 'git log $HOME', 'git log $env:HOME',
    'npm test\necho hi', 'npm test\r\necho hi', 'git status\u2028rm x', 'git status\u0000x', 'git log (Get-Date)', '& npm test',
    'Get-ChildItem | ForEach-Object { Remove-Item $_ }', 'git log {a,b}', 'git status;', 'git status &&', '"git log" | cat',
    "cat > src/pricing/total.ts <<'EOF'\nexport const x = 1\nEOF",
    "Set-Content -Path src/pricing/total.ts -Value @'\nexport const x = 1\n'@",
    'echo {} > .seam/lock.json',
  ];
  describe.each(TOOLS)('%s', (tool) => {
    test.each(CHAINED)('%j', (command) => expect(whyNot(s, command, { tool })).toMatch(ONE_AT_A_TIME));
  });
  test('the reason says what is not allowed', () => expect(whyNot(s, 'npm test | cat')).toMatch(/not allowed/));
  test('a quote that is never closed is refused too', () => expect(whyNot(s, 'git log "abc')).toMatch(/never closed/));
  test('a `;` inside quotes is still refused (the guard does not try to understand the shell)', () => {
    expect(whyNot(s, 'git log --grep="a;b"')).toMatch(ONE_AT_A_TIME);
  });
});

describe('rule 3: no background runs', () => {
  const BACKGROUND = [
    'npm test &', 'npm test  & ', 'git log&', 'Start-Process node -ArgumentList x.js', 'start-process node', 'saps node x', 'cmd /c start /b node x', 'start /b node x',
    'nohup node x', 'Start-Job node', 'sajb node', 'Start-ThreadJob node', 'powershell -WindowStyle Hidden -File x.ps1', 'setsid node x', 'disown',
    'node server.js &',
  ];
  describe.each(TOOLS)('%s', (tool) => {
    test.each(BACKGROUND)('%s', (command) => expect(whyNot(s, command, { tool })).toBe("background runs aren't allowed"));
  });
  test.each([true, 'true', 1, { yes: 1 }])('the tool\'s own run_in_background field (%j) is refused for a command that is on the list', (asked) => {
    expect(whyNot(s, 'npm test', { extra: { run_in_background: asked } })).toBe("background runs aren't allowed");
  });
  test('&& is chaining, not a background run', () => expect(whyNot(s, 'npm test && npm test')).toMatch(ONE_AT_A_TIME));
});

describe('rule 4: only the owner approves, and git hooks always run', () => {
  const approving = (): string[] => [
    'seam approve', 'seam approve --kind freeze', 'SEAM APPROVE', 'Seam Approve', 'seam  approve', 'seam appr""ove', "seam 'appr'ove", 'seam "approve"',
    'node dist/seam.mjs approve --kind freeze', 'npx seam approve', `node "${join(s.app.pluginRoot, 'dist', 'seam.mjs')}" approve --kind freeze`,
    'node C:/Users/someone/plugin/dist/seam.mjs approve', 'node seam.mjs approve', 'bash -c "seam approve"', 'seam request approve',
  ];
  test.each(TOOLS)('%s: any command that has approve and seam in it is refused, with the owner named', (tool) => {
    for (const command of approving()) expect(whyNot(s, command, { tool }), command).toMatch(/approval window.*never runs seam approve/);
  });
  test('approve on its own, without seam, is only a word', () => {
    expectRuns(s, 'git log --grep=approve');
  });
  test.each(['git commit --no-verify -m x', 'git log --no-verify', 'npm test --no-verify', 'git push --NO-VERIFY'])('%s', (command) => {
    expect(whyNot(s, command)).toBe('--no-verify is not allowed: the git hooks always run');
  });
});

describe('programs that start another program, or run code from text, are not on the list', () => {
  const RUNS_CODE = [
    'Invoke-Expression x', 'iex x', 'powershell -EncodedCommand abc', 'powershell -enc abc', 'powershell -c x', 'powershell -Command x', 'pwsh -c x', 'pwsh -File x.ps1',
    'cmd /c dir', 'cmd.exe /c dir', 'bash -c x', 'sh -c x', 'zsh -c x', 'node -e x', 'node --eval x', 'node -p 1', 'node --print 1', 'node x.js', 'node ./x.mjs',
    'node -r ./x.js y', 'node --import ./x.js y', 'node', 'node --version x', 'npx foo', 'npx vitest', 'npx tsc', 'npx -y vitest run', 'npx --no-install vitest run',
    'env FOO=1 node x', 'env', 'FOO=1 npm test', 'GIT_EXTERNAL_DIFF=x git diff', 'python x.py', 'eval x', 'exec x', 'Invoke-Command x', '. ./x.ps1', './x.sh', '.\\x.ps1', 'x.exe',
  ];
  describe.each(TOOLS)('%s', (tool) => {
    test.each(RUNS_CODE)('%s', (command) => expect(whyNot(s, command, { tool })).toMatch(/isn't on seam's command list|isn't allowed here/));
  });
  test('node with a script of its own is not the plugin\'s script, even one named seam.mjs', () => {
    expect(whyNot(s, 'node ./dist/seam.mjs report', { cwd: s.app.root })).toMatch(/isn't on seam's command list/);
    expect(whyNot(s, `node ${join(s.app.root, 'seam.mjs')} report`)).toMatch(/isn't on seam's command list/);
  });
  test('the plugin\'s script with a subcommand that is not on the list', () => {
    expect(whyNot(s, `node "${join(s.app.pluginRoot, 'dist', 'seam.mjs')}" bogus`)).toMatch(/'seam bogus' isn't allowed here: that is not one of the seam commands/);
    expect(whyNot(s, `node "${join(s.app.pluginRoot, 'dist', 'seam.mjs')}"`)).toMatch(/isn't allowed here/);
  });
});

describe('programs that are on the list, used in a way that is not', () => {
  const WRONG = (name: string): RegExp => new RegExp(`'${name}[^']*' isn't allowed here`);
  test.each(['seam bogus', 'seam', 'seam reports', 'seam commit', 'seam add x'])('%s', (command) => expect(whyNot(s, command)).toMatch(/isn't allowed here: that is not one of the seam commands/));
  test.each([
    'git branch -d x', 'git branch -D x', 'git branch -m a b', 'git branch -M a b', 'git branch -c a b', 'git branch -C a b', 'git branch -f x', 'git branch -u x',
    'git branch --delete x', 'git branch --move a b', 'git branch --copy a b', 'git branch --force x', 'git branch --set-upstream-to=x', 'git branch --edit-description',
    'git branch -vd x', 'git branch -ad', 'git branch newname', 'git branch newname HEAD', 'git branch -a newname', 'git branch --unset-upstream',
  ])('%s', (command) => expect(whyNot(s, command)).toMatch(WRONG('git branch')));
  test.each([
    'git log --output=x', 'git log --output x', 'git diff --output=x', 'git show --output=x', 'git diff --ext-diff', 'git diff --textconv', 'git show --textconv',
    'git log --ext-diff -p', 'git log --out=x', 'git diff --ext', 'git diff --o=x', 'git diff --tex', 'git diff --textconv=x', 'git status --output=x',
  ])('%s', (command) => expect(whyNot(s, command)).toMatch(/isn't allowed here: that option can write a file or run a program/));
  test.each(['git diff --no-index a b', 'git diff --no-index=x', 'git diff --no-i a b', 'git diff --no-ind a b'])('%s reads files outside git', (command) => {
    expect(whyNot(s, command)).toMatch(/isn't allowed here: that option reads files outside git; the Read tool is for that/);
  });
  test('--text is the start of --textconv, so it is refused too (a known cost of refusing every abbreviation)', () => {
    expect(whyNot(s, 'git diff --text')).toMatch(/can write a file or run a program/);
  });
  test.each([
    'git commit', 'git add .', 'git push', 'git pull', 'git reset --hard', 'git checkout x', 'git switch x', 'git stash', 'git tag x', 'git clean -fd', 'git merge x',
    'git rebase x', 'git restore x', 'git apply x', 'git config x y', 'git rm x', 'git mv a b', 'git -C x status', 'git -c core.pager=x status', 'git --git-dir=x status',
    'git --exec-path=x status', 'git', 'git remote add x y', 'git worktree add x', 'git submodule update', 'git gc', 'git fetch', 'git cherry-pick x', 'git revert x',
  ])('%s', (command) => expect(whyNot(s, command)).toMatch(/^'git[^']*' isn't on seam's command list/));
  test.each([
    'npm test --silent', 'npm test x', 'npm test -- x', 'npm run test -- --reporter=x', 'npm run typecheck x', 'npm test --script-shell=x', 'npm test --prefix x',
  ])('%s', (command) => expect(whyNot(s, command)).toMatch(/take nothing added/));
  test.each(['npm run build', 'npm install', 'npm i x', 'npm ci', 'npm run', 'npm', 'npm exec x', 'npm start', 'npm run dev', 'npm --version x', 'npm -v'])('%s', (command) => {
    expect(whyNot(s, command)).toMatch(/^'npm[^']*' isn't on seam's command list/);
  });
  test.each(['npx vitest run --config evil.js', 'npx vitest run --reporter=./x.js', 'npx vitest run -c x', 'npx vitest run test/a.ts --coverage', 'npx vitest run --root x'])('%s', (command) => {
    expect(whyNot(s, command)).toMatch(/isn't allowed here: it takes test file paths only/);
  });
});
