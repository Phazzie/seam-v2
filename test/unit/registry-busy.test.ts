// registerProject replaces the project list with atomicWrite, so a Windows reader that has the list open for a
// moment (the rename then answers EPERM, EBUSY or EACCES) makes it wait and try again instead of failing.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { REGISTRY_LOCK, registerProject } from '../../src/lib/registry.ts';
import { resolveReal } from '../../src/lib/paths.ts';
import { tempDir } from '../helpers/project.ts';

const state = vi.hoisted(() => ({ left: 0, hits: 0, code: 'EPERM' }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: ((...args: Parameters<typeof actual.renameSync>) => {
      if (state.left > 0 && String(args[1]).endsWith('projects.json')) {
        state.left -= 1;
        state.hits += 1;
        throw Object.assign(new Error(`${state.code}, operation not permitted (injected)`), { code: state.code });
      }
      return actual.renameSync(...args);
    }) as typeof actual.renameSync,
  };
});

beforeEach(() => { state.left = 0; state.hits = 0; state.code = 'EPERM'; });
afterEach(() => { state.left = 0; });

const listed = (data: string): string[] => (JSON.parse(readFileSync(join(data, 'projects.json'), 'utf8')) as { projects: string[] }).projects;

describe('registerProject when the list is busy for a moment', () => {
  test.each(['EPERM', 'EBUSY', 'EACCES'])('%s on the replace three times: it waits, the project is listed, nothing is left over', (code) => {
    const data = tempDir();
    const root = tempDir();
    state.left = 3;
    state.code = code;
    registerProject(root, data);
    expect(state.hits).toBe(3);
    expect(listed(data)).toEqual([resolveReal(root, '.')]);
    expect(existsSync(join(data, REGISTRY_LOCK))).toBe(false);
    expect(readdirSync(data).sort()).toEqual(['projects.json']);
  });

  test('busy for good: a plain error that names the list, the old list is untouched, and no temp file or lock is left', () => {
    const data = tempDir();
    const first = tempDir();
    registerProject(first, data);
    state.left = Number.MAX_SAFE_INTEGER;
    expect(() => registerProject(tempDir(), data)).toThrow(/Could not replace .*projects\.json: it stayed busy/);
    state.left = 0;
    expect(listed(data)).toEqual([resolveReal(first, '.')]);
    expect(existsSync(join(data, REGISTRY_LOCK))).toBe(false);
    expect(readdirSync(data).sort()).toEqual(['projects.json']);
  });
});
