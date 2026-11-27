import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { parseState } from '../../src/formats/state.ts';
import type { SeamState } from '../../src/formats/state.ts';
import { readState, recordBlock, rootKey, withLock, writeState } from '../../src/lib/store.ts';
import { put, tempDir } from '../helpers/project.ts';

const run = promisify(execFile);
const WORKER = resolve(import.meta.dirname, '../helpers/store-worker.ts');
const WIN = process.platform === 'win32';

/** A seam project folder and a data folder, both empty except for `.seam/`. */
function setup(): { root: string; data: string } {
  const root = tempDir();
  mkdirSync(join(root, '.seam'));
  return { root, data: tempDir() };
}

const fresh = (changes: Record<string, unknown> = {}): SeamState =>
  parseState({
    version: 1, phase: 'build', turn: { agentId: null, file: null, startedAt: null },
    strikes: {}, parked: [], approvals: [], blocks: 0, halted: null, ...changes,
  });

/** Start `count` real node processes that all begin at the same moment, and wait for all of them. */
async function parallel(mode: string, root: string, data: string, count: number, times = 1): Promise<void> {
  const goAt = Date.now() + 3000; // time for every process to boot before the start signal
  await Promise.all(
    Array.from({ length: count }, () => run(process.execPath, [WORKER, mode, root, data, String(goAt), String(times)])),
  );
}

const lockPath = (root: string): string => join(root, '.seam', '.lock');
const ago = (ms: number): Date => new Date(Date.now() - ms);

describe('withLock', () => {
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

  test('8 processes racing to break the same stale lock still go in one at a time', async () => {
    const { root, data } = setup();
    put(root, '.seam/counter.txt', '0');
    writeFileSync(lockPath(root), 'left behind by a crash');
    utimesSync(lockPath(root), ago(60_000), ago(60_000));
    await parallel('incr', root, data, 8, 3);
    expect(readFileSync(join(root, '.seam', 'counter.txt'), 'utf8')).toBe('24');
    expect(existsSync(lockPath(root))).toBe(false);
  });

  test('a clearing guard left by a crash is cleared along with the old lock', () => {
    const { root } = setup();
    for (const name of ['.lock', '.lock.break']) {
      writeFileSync(join(root, '.seam', name), 'left behind by a crash');
      utimesSync(join(root, '.seam', name), ago(60_000), ago(60_000));
    }
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });

  test('while another process is clearing the old lock (a fresh guard), this one waits and gives up rather than barge in', () => {
    const { root } = setup();
    writeFileSync(lockPath(root), 'left behind by a crash');
    utimesSync(lockPath(root), ago(60_000), ago(60_000));
    writeFileSync(`${lockPath(root)}.break`, 'someone else, right now');
    let ran = false;
    expect(() => withLock(root, () => { ran = true; }, { waitMs: 200, staleMs: 30_000 })).toThrow(/another seam/i);
    expect(ran).toBe(false);
  });

  test('lets go of the lock when the function throws, and throws the same error', () => {
    const { root } = setup();
    const boom = new Error('boom');
    expect(() => withLock(root, () => { throw boom; })).toThrow(boom);
    expect(existsSync(lockPath(root))).toBe(false);
    expect(withLock(root, () => 'again')).toBe('again');
  });

  test('a lock left by a crash more than 30 s ago is cleared', () => {
    const { root } = setup();
    writeFileSync(lockPath(root), '1234 long ago');
    utimesSync(lockPath(root), ago(31_000), ago(31_000));
    expect(withLock(root, () => 'ran')).toBe('ran');
    expect(existsSync(lockPath(root))).toBe(false);
    expect(readdirSync(join(root, '.seam'))).toEqual([]);
  });

  test('a fresh lock held by someone else is waited for, then refused with a plain reason; the function never runs', () => {
    const { root } = setup();
    writeFileSync(lockPath(root), '1234 just now');
    let ran = false;
    const started = Date.now();
    expect(() => withLock(root, () => { ran = true; }, { waitMs: 300, staleMs: 30_000 })).toThrow(/another seam .*\.seam[\\/]\.lock/i);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    expect(ran).toBe(false);
    expect(readFileSync(lockPath(root), 'utf8')).toBe('1234 just now');
  });

  test('a lock someone else took over (ours ran past the stale limit) is not removed on the way out', () => {
    const { root } = setup();
    withLock(root, () => writeFileSync(lockPath(root), 'taken over by another process'));
    expect(readFileSync(lockPath(root), 'utf8')).toBe('taken over by another process');
  });

  test('a missing .seam folder is a plain error, not a raw ENOENT', () => {
    expect(() => withLock(tempDir(), () => 1)).toThrow(/records folder is missing.*\.seam/i);
  });
});

describe('writeState and readState', () => {
  test('writes .seam/state.json and an identical mirror under <data>/mirror/<root key>/', () => {
    const { root, data } = setup();
    writeState(root, data, fresh({ blocks: 3 }));
    const text = readFileSync(join(root, '.seam', 'state.json'), 'utf8');
    const mirror = join(data, 'mirror', rootKey(root), 'state.json');
    expect(readFileSync(mirror, 'utf8')).toBe(text);
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

describe('recordBlock', () => {
  test('logs "Blocked: <who> <what>" and adds one to blocks, in the file and in the mirror', () => {
    const { root, data } = setup();
    writeState(root, data, fresh({ blocks: 4 }));
    recordBlock(root, data, 'builder', 'tried to write src/total.ts');
    expect(readState(root).blocks).toBe(5);
    expect(readFileSync(join(root, '.seam', 'log.md'), 'utf8')).toMatch(/^\d\d:\d\d Blocked: builder tried to write src\/total\.ts\n$/);
    expect(JSON.parse(readFileSync(join(data, 'mirror', rootKey(root), 'state.json'), 'utf8')).blocks).toBe(5);
  });

  test('10 parallel processes blocking twice each: all 20 counted, all 20 logged', async () => {
    const { root, data } = setup();
    writeState(root, data, fresh());
    await parallel('block', root, data, 10, 2);
    expect(readState(root).blocks).toBe(20);
    expect(readFileSync(join(root, '.seam', 'log.md'), 'utf8').trimEnd().split('\n')).toHaveLength(20);
  });
});
