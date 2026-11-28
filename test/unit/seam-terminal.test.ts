// The real terminal side of the owner's commands (src/cli/terminal.ts), run as a child process with its input piped: more than
// one question is answered from the lines that were typed, and input that ends before an answer is an error, not a quiet exit.
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { put, tempDir } from '../helpers/project.ts';

const MODULE = pathToFileURL(resolve(import.meta.dirname, '../../src/cli/terminal.ts')).href;

/** Run a script that asks two questions through the terminal, with `typed` on its stdin. */
function asking(typed: string): { stdout: string; stderr: string; status: number | null } {
  const dir = tempDir();
  put(dir, 'ask.mjs', [
    `import { terminal } from ${JSON.stringify(MODULE)};`,
    "const t = terminal(() => 'x');",
    'try {',
    "  console.log('first=' + await t.io.ask('one? '));",
    "  console.log('second=' + await t.io.ask('two? '));",
    '} catch (err) {',
    "  console.log('failed=' + err.message);",
    '  process.exitCode = 3;',
    '} finally {',
    '  t.close();',
    '}',
    '',
  ].join('\n'));
  const done = spawnSync(process.execPath, [join(dir, 'ask.mjs')], { input: typed, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  return { stdout: done.stdout, stderr: done.stderr, status: done.status };
}

describe('the terminal', () => {
  test('piped input is not a keyboard', () => {
    const done = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(MODULE)}).then(({ terminal }) => { const { io } = terminal(() => 'x'); console.log(io.stdinTty, io.stdoutTty); })`], { input: '', encoding: 'utf8', windowsHide: true });
    expect(done.stdout.trim()).toBe('false false');
  });

  test('two questions are answered from two typed lines, and the process ends on its own', () => {
    const r = asking('ABCD\nyes\n');
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('first=ABCD');
    expect(r.stdout).toContain('second=yes');
    expect(r.status).toBe(0);
  });

  test('input that ends before an answer fails the question, so a command can stop with an error', () => {
    const r = asking('ABCD\n');
    expect(r.stdout).toContain('first=ABCD');
    expect(r.stdout).toMatch(/failed=The input ended before an answer was typed/);
    expect(r.status).toBe(3);
  });
});
