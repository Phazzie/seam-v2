// The launchers in bin/ (R77): `bin/seam` is run by sh, so a Windows checkout (autocrlf) must not turn its line endings into CRLF, which
// breaks the shebang line; `bin/seam.cmd` is run by cmd and keeps CRLF. .gitattributes says so, and the files are as it says.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO = resolve(import.meta.dirname, '../..');

describe('bin/', () => {
  test('.gitattributes keeps bin/seam as text with LF endings', () => {
    const done = spawnSync('git', ['check-attr', 'text', 'eol', '--', 'bin/seam'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
    expect(done.stdout).toContain('bin/seam: text: set');
    expect(done.stdout).toContain('bin/seam: eol: lf');
  });

  test('bin/seam is a sh script with LF endings, and bin/seam.cmd a batch file with CRLF', () => {
    const sh = readFileSync(resolve(REPO, 'bin/seam'), 'utf8');
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true);
    expect(sh).not.toContain('\r');
    const cmd = readFileSync(resolve(REPO, 'bin/seam.cmd'), 'utf8');
    expect(cmd.endsWith('\r\n')).toBe(true);
    expect(cmd.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
});
