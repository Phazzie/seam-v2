import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { SeamState } from '../../src/formats/state.ts';
import { readState, recordBlock, rootKey, updateState, withLock, writeState } from '../../src/lib/store.ts';
import { fresh, lockPath, parallel, setup } from '../helpers/store-procs.ts';
import { put, tempDir } from '../helpers/project.ts';

const WIN = process.platform === 'win32';
const mirrorOf = (root: string, data: string): string => join(data, 'mirror', rootKey(root), 'state.json');

describe('withLock (more in lock.test.ts)', () => {
  test('returns what the function returns and leaves no lock behind', () => {
    const { root } = setup();
    expect(withLock(root, () => 42)).toBe(42);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  test('20 parallel processes each add 1 under the lock and the total is 20', async () => {
    const { root, data } = setup();
    put(root, '.seam/counter.txt', '0');
    await parallel('incr', root, data, 20);
    expect(readFileSync(join(root, '.seam', 'counter.txt'), 'utf8')).toBe('20');
    expect(existsSync(lockPath(root))).toBe(false);
  });
});

describe('writeState and readState', () => {
  test('writes .seam/state.json and an identical mirror under <data>/mirror/<root key>/', () => {
    const { root, data } = setup();
    writeState(root, data, fresh({ blocks: 3 }));
    const text = readFileSync(join(root, '.seam', 'state.json'), 'utf8');
    expect(readFileSync(mirrorOf(root, data), 'utf8')).toBe(text);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(readState(root).blocks).toBe(3);
  });

  test('a second write replaces the first, and no temp files are left in either folder', () => {
    const { root, data } = setup();
    writeState(root, data, fresh({ blocks: 1 }));
    writeState(root, data, fresh({ blocks: 2 }));
    expect(readState(root).blocks).toBe(2);
    expect(readdirSync(join(root, '.seam'))).toEqual(['state.json']);
    expect(readdirSync(join(data, 'mirror', rootKey(root)))).toEqual(['state.json']);
  });

  test('state that does not fit the format is refused and the old file stays', () => {
    const { root, data } = setup();
    writeState(root, data, fresh({ blocks: 1 }));
    const bad = { ...fresh(), blocks: -1 } as SeamState;
    expect(() => writeState(root, data, bad)).toThrow(/blocks/);
    expect(readState(root).blocks).toBe(1);
  });

  test('a folder with no .seam is a plain error and no mirror is made for it', () => {
    const root = tempDir();
    const data = tempDir();
    expect(() => writeState(root, data, fresh())).toThrow(/records folder is missing.*cannot be written/i);
    expect(readdirSync(data)).toEqual([]);
  });

  test('reading a project with no state.json is a plain error', () => {
    const { root } = setup();
    expect(() => readState(root)).toThrow(/state\.json.*missing/i);
  });
});

describe('rootKey', () => {
  test('is 16 hex characters, the same for every spelling of one folder, different for another folder', () => {
    const { root } = setup();
    expect(rootKey(root)).toMatch(/^[0-9a-f]{16}$/);
    expect(rootKey(join(root, '.seam', '..'))).toBe(rootKey(root));
    if (WIN) expect(rootKey(root.toUpperCase())).toBe(rootKey(root));
    expect(rootKey(tempDir())).not.toBe(rootKey(root));
  });
});

describe('updateState', () => {
  test('reads, changes and writes under the lock, returns the new state, and the mirror matches', () => {
    const { root, data } = setup();
    writeState(root, data, fresh({ blocks: 4 }));
    const next = updateState(root, data, (s) => ({ ...s, blocks: s.blocks + 1, halted: 'stop' }));
    expect(next.blocks).toBe(5);
    expect(readState(root)).toEqual(next);
    expect(readFileSync(mirrorOf(root, data), 'utf8')).toBe(readFileSync(join(root, '.seam', 'state.json'), 'utf8'));
    expect(existsSync(lockPath(root))).toBe(false);
  });

  test('when the change throws, nothing is written and the lock is let go', () => {
    const { root, data } = setup();
    writeState(root, data, fresh({ blocks: 4 }));
    const boom = new Error('boom');
    expect(() => updateState(root, data, () => { throw boom; })).toThrow(boom);
    expect(readState(root).blocks).toBe(4);
    expect(existsSync(lockPath(root))).toBe(false);
  });

  test('a new state that does not fit the format is refused', () => {
    const { root, data } = setup();
    writeState(root, data, fresh());
    expect(() => updateState(root, data, (s) => ({ ...s, blocks: -1 }))).toThrow(/blocks/);
    expect(readState(root).blocks).toBe(0);
  });

  test('10 parallel processes updating twice each: all 20 land', async () => {
    const { root, data } = setup();
    writeState(root, data, fresh());
    await parallel('update', root, data, 10, 2);
    expect(readState(root).blocks).toBe(20);
  });
});

describe('recordBlock', () => {
  test('logs "Blocked: <who> <what>" and adds one to blocks, in the file and in the mirror', () => {
    const { root, data } = setup();
    writeState(root, data, fresh({ blocks: 4 }));
    recordBlock(root, data, 'builder', 'tried to write src/total.ts');
    expect(readState(root).blocks).toBe(5);
    expect(readFileSync(join(root, '.seam', 'log.md'), 'utf8')).toMatch(/^\d\d:\d\d Blocked: builder tried to write src\/total\.ts\n$/);
    expect(JSON.parse(readFileSync(mirrorOf(root, data), 'utf8')).blocks).toBe(5);
  });

  test('10 parallel processes blocking twice each: all 20 counted, all 20 logged', async () => {
    const { root, data } = setup();
    writeState(root, data, fresh());
    await parallel('block', root, data, 10, 2);
    expect(readState(root).blocks).toBe(20);
    expect(readFileSync(join(root, '.seam', 'log.md'), 'utf8').trimEnd().split('\n')).toHaveLength(20);
  });
});
