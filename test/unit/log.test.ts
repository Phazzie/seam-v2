import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { logLine } from '../../src/lib/log.ts';
import { tempDir } from '../helpers/project.ts';

function setup(): string {
  const root = tempDir();
  mkdirSync(join(root, '.seam'));
  return root;
}
const read = (root: string): string => readFileSync(join(root, '.seam', 'log.md'), 'utf8');

describe('logLine', () => {
  test('appends "HH:MM <text>" in local time, one line each, with \\n endings', () => {
    const root = setup();
    logLine(root, 'Owner approved features', new Date(2026, 10, 27, 9, 5));
    logLine(root, 'Blocked: builder tried to edit the plan', new Date(2026, 10, 27, 23, 41));
    expect(read(root)).toBe('09:05 Owner approved features\n23:41 Blocked: builder tried to edit the plan\n');
  });

  test('uses the current time when none is given', () => {
    const root = setup();
    logLine(root, 'hello');
    expect(read(root)).toMatch(/^\d\d:\d\d hello\n$/);
  });

  test('keeps one entry on one line, even when the text has line breaks', () => {
    const root = setup();
    logLine(root, 'Blocked: main ran\r\nrm -rf x\n  and more');
    const lines = read(root).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d\d:\d\d Blocked: main ran rm -rf x and more$/);
  });

  test('a missing .seam folder is an error, not a silent skip', () => {
    expect(() => logLine(tempDir(), 'x')).toThrow();
  });
});
