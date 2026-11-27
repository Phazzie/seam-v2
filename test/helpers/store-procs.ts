// Test helpers for the store and lock tests: a throwaway seam project folder, a state value, and
// real node processes (store-worker.ts) that all start at the same moment.
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseState } from '../../src/formats/state.ts';
import type { SeamState } from '../../src/formats/state.ts';
import { tempDir } from './project.ts';

const run = promisify(execFile);
const WORKER = resolve(import.meta.dirname, 'store-worker.ts');

/** A seam project folder and a data folder, both empty except for `.seam/`. */
export function setup(): { root: string; data: string } {
  const root = tempDir();
  mkdirSync(join(root, '.seam'));
  return { root, data: tempDir() };
}

export const fresh = (changes: Record<string, unknown> = {}): SeamState =>
  parseState({
    version: 1, phase: 'build', turn: { agentId: null, file: null, startedAt: null },
    strikes: {}, parked: [], approvals: [], blocks: 0, halted: null, ...changes,
  });

/**
 * Start `count` real node processes that all begin at the same moment, wait for all of them, and
 * return what each printed. A process that crashes makes this reject with its error.
 */
export async function parallel(mode: string, root: string, data: string, count: number, times = 1): Promise<string[]> {
  const goAt = Date.now() + 3000; // time for every process to boot before the start signal
  const done = await Promise.all(
    Array.from({ length: count }, () => run(process.execPath, [WORKER, mode, root, data, String(goAt), String(times)])),
  );
  return done.map((d) => d.stdout);
}

export const lockPath = (root: string): string => join(root, '.seam', '.lock');
export const ago = (ms: number): Date => new Date(Date.now() - ms);
