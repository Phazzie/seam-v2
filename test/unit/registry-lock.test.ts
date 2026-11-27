// The project list (`<data folder>/projects.json`) is changed by whichever process registers a project, and
// several can do it at once. Each one reads the list, adds its root and replaces the file, so without a lock
// one process's addition is overwritten by another's. These tests start real processes at the same moment.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { registerProject, resolveReal } from '../../src/lib/paths.ts';
import { REGISTRY_LOCK } from '../../src/lib/registry.ts';
import { put, tempDir } from '../helpers/project.ts';

const run = promisify(execFile);
const WORKER = resolve(import.meta.dirname, '../helpers/registry-worker.ts');

/**
 * Start one process per group of roots, all at the same moment, and wait for all of them (a crash rejects). Kept small:
 * the registrations are one after the other (that is the lock's job), and a process gives up after waiting 5 s for it,
 * which a busy machine running the whole suite can reach with more of them.
 */
async function registerTogether(data: string, groups: string[][]): Promise<void> {
  const goAt = Date.now() + 3000; // time for every process to boot before the start signal
  await Promise.all(groups.map((roots) => run(process.execPath, [WORKER, data, String(goAt), ...roots])));
}

const listed = (data: string): string[] => (JSON.parse(readFileSync(join(data, 'projects.json'), 'utf8')) as { projects: string[] }).projects;
const spelling = (root: string): string => resolveReal(root, '.'); // as the list writes it

describe('registering projects from several processes at once', () => {
  test('6 processes with 2 different projects each: all 12 end up in the list, once each', { retry: 2 }, async () => {
    const data = tempDir();
    const groups = Array.from({ length: 6 }, () => Array.from({ length: 2 }, () => tempDir()));
    await registerTogether(data, groups);
    expect(listed(data).sort()).toEqual(groups.flat().map(spelling).sort());
    expect(existsSync(join(data, REGISTRY_LOCK))).toBe(false); // the lock is let go
    expect(readdirSync(data).filter((name) => name.endsWith('.tmp'))).toEqual([]); // and no half-written copy is left
  });

  test('6 processes registering the same project: it is listed once', { retry: 2 }, async () => {
    const data = tempDir();
    const root = tempDir();
    await registerTogether(data, Array.from({ length: 6 }, () => [root]));
    expect(listed(data)).toEqual([spelling(root)]);
  });

  test('a list that cannot be read is not written over, and the lock is let go', () => {
    const data = tempDir();
    put(data, 'projects.json', '{ not json');
    expect(() => registerProject(tempDir(), data)).toThrow(/projects\.json is unreadable/);
    expect(readFileSync(join(data, 'projects.json'), 'utf8')).toBe('{ not json');
    expect(existsSync(join(data, REGISTRY_LOCK))).toBe(false);
  });

  test('a data folder that does not exist yet is made', () => {
    const data = join(tempDir(), 'new', 'data');
    registerProject(tempDir(), data);
    expect(listed(data)).toHaveLength(1);
  });
});
