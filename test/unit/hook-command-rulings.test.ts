// R56, R57 and R59 in the real bundle (dist/hook.mjs, run as a child process the way Claude Code runs it): what the
// unit tests ask of the decisions directly, asked of the hook that reads Claude Code's JSON and prints its answer.
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { expectAllowed, expectDenied, pre, run } from '../helpers/calls.ts';

const NBSP = String.fromCodePoint(0xa0);
const LEFT_QUOTE = String.fromCodePoint(0x2018);
const RIGHT_QUOTE = String.fromCodePoint(0x2019);

describe('R56 in the hook: the words must be the words the shell passes on', () => {
  test('PowerShell: a non-breaking space where a space would be', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(run('PowerShell', `git diff HEAD${NBSP}--output=evil.txt`)), /plain ASCII only/);
  });
  test('PowerShell: curly quotes', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(run('PowerShell', `git diff ${LEFT_QUOTE}--output=evil.txt${RIGHT_QUOTE}`)), /plain ASCII only/);
  });
  test('PowerShell: a comma list', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(run('PowerShell', 'git diff HEAD,--output=evil.txt')), /comma is not allowed/);
  });
  test('Bash: a backslash that hides an option', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(run('Bash', 'git diff \\--output=evil.txt')), /backslash before/);
    expectDenied(await app.hook(run('Bash', 'git diff --out\\put=evil.txt')), /can write a file or run a program/);
  });
});

describe('R57 in the hook: outside the project only the temp folder is writable', () => {
  test.each(['.gitconfig', '.npmrc', '.bashrc'])('~/%s is refused', async (name) => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(pre('Write', { file_path: join(homedir(), name), content: 'x\n' })), /only the temp folder is writable/);
  });
  test('a file in the temp folder is allowed', async () => {
    const app = await makeApp({ phase: 'build' });
    expectAllowed(await app.hook(pre('Write', { file_path: join(tmpdir(), 'seam-hook-test', 'notes.txt'), content: 'x\n' })));
  });
});

describe('R59 in the hook: the tests run only in the build and flip phases', () => {
  test.each(['setup', 'plan1', 'skeleton', 'tests'] as const)('npm test is refused in %s, and typecheck is not', async (phase) => {
    const app = await makeApp({ phase });
    expectDenied(await app.hook(run('Bash', 'npm test')), /tests run through the seam scripts in this phase/);
    expectDenied(await app.hook(run('PowerShell', 'npx vitest run')), /tests run through the seam scripts in this phase/);
    expectAllowed(await app.hook(run('Bash', 'npm run typecheck')));
  });
  test.each(['build', 'flip'] as const)('npm test is allowed in %s', async (phase) => {
    const app = await makeApp({ phase });
    expectAllowed(await app.hook(run('Bash', 'npm test')));
    expectAllowed(await app.hook(run('PowerShell', 'npx vitest run test/total.test.ts')));
  });
});

describe('R61 and R62 in the hook', () => {
  test('PowerShell: a word that Windows PowerShell 5.1 would split into more arguments', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(run('PowerShell', "git log -1 'a b\\' 'c --output=x'")), /a word with a space or a double quote/);
    expectDenied(await app.hook(run('PowerShell', "git diff 'a'--output=x")), /a word with a space or a double quote/);
    expectDenied(await app.hook(run('PowerShell', "git log -1 'x\\\" --output=.claude/settings.json'")), /a word with a space or a double quote/);
  });
  test('PowerShell: --% and %VAR% and @name', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(run('PowerShell', 'git diff --% %CLAUDE_JOB_DIR%')), /a %, a @ or --% is not allowed/);
    expectDenied(await app.hook(run('PowerShell', 'git diff @HOME')), /a %, a @ or --% is not allowed/);
  });
  test('PowerShell: a plain command still runs', async () => {
    const app = await makeApp({ phase: 'build' });
    expectAllowed(await app.hook(run('PowerShell', 'git log -1')));
  });
  test('the stuck-on value of -O is path-checked, and the odd spellings are refused', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(run('Bash', 'git diff -O.seam/state.json')), /records/);
    expectDenied(await app.hook(run('Bash', 'git show :0:.seam/state.json')), /that way of writing a path/);
    expectDenied(await app.hook(run('Bash', 'git diff ~+/.seam/state.json')), /that way of writing a path/);
    expectDenied(await app.hook(run('Bash', 'git log -L1,5:src/a.ts')), /names a line range/);
  });
  test('vitest.cpl, and a file with an extension from the machine\'s PATHEXT, are code the main AI cannot write', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(pre('Write', { file_path: app.abs('vitest.cpl'), content: 'x\n' })), /not in the plan/);
    expectDenied(await app.hook(pre('Write', { file_path: app.abs('vitest.foo'), content: 'x\n' }), { env: { PATHEXT: '.COM;.EXE;.FOO' } }), /not in the plan/);
  });
  test('.gitattributes is a config file', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(pre('Write', { file_path: app.abs('.gitattributes'), content: '* filter=x\n' })), /config files are frozen/);
  });
});

describe('R64 in the hook: PowerShell 5.1 splits an unquoted one-dash word at a dot (a colon is refused too), and drops an empty word', () => {
  test.each(['git log -pp.seam/state.json', 'git diff -pO.claude/settings.json', 'git log -U3.seam/state.json', 'git log -a=x/.seam/state.json', 'git diff -a:--output=x'])(
    'PowerShell: %s', async (command) => {
      const app = await makeApp({ phase: 'build' });
      expectDenied(await app.hook(run('PowerShell', command)), /PowerShell may split this option at the dot or colon; write it differently/);
    },
  );
  test('PowerShell: an empty quoted word', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(run('PowerShell', "git log ''")), /an empty quoted word is not allowed/);
    expectDenied(await app.hook(run('PowerShell', 'git log ""')), /an empty quoted word is not allowed/);
  });
  test('PowerShell: the plain commands still run', async () => {
    const app = await makeApp({ phase: 'build' });
    for (const command of ['git log --oneline -5', 'git diff HEAD~1 -- src/x.ts', 'npx vitest run test/unit/x.test.ts', 'git log -1']) {
      expectAllowed(await app.hook(run('PowerShell', command)));
    }
  });
  test('Bash: the file stuck to -O in a cluster is path-checked', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(run('Bash', 'git diff -pO.claude/settings.json')), /may not touch/);
    expectAllowed(await app.hook(run('Bash', 'git diff -pU3')));
  });
});
