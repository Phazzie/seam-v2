import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseState } from '../../src/formats/state.ts';
import { HEARTBEAT_GAP_MS, heartbeatGaps, touchHeartbeat } from '../../src/lib/heartbeat.ts';
import { writeState } from '../../src/lib/store.ts';
import type { Phase } from '../../src/types.ts';
import { tempDir } from '../helpers/project.ts';

const T0 = new Date('2026-11-27T10:00:00.000Z');
const later = (ms: number): Date => new Date(T0.getTime() + ms);
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function setup(phase: Phase): string {
  const root = tempDir();
  mkdirSync(join(root, '.seam'));
  const state = parseState({
    version: 1, phase, turn: { agentId: null, file: null, startedAt: null },
    strikes: {}, parked: [], approvals: [], blocks: 0, halted: null,
  });
  writeState(root, tempDir(), state);
  return root;
}
const file = (root: string): string => join(root, '.seam', 'heartbeat.json');
const saved = (root: string): { lastSeen: string; gaps: unknown[] } => JSON.parse(readFileSync(file(root), 'utf8'));

describe('touchHeartbeat and heartbeatGaps', () => {
  test('the gap limit is 10 minutes', () => expect(HEARTBEAT_GAP_MS).toBe(10 * MIN));

  test('the first check-in creates the file with lastSeen and no gaps', () => {
    const root = setup('build');
    expect(heartbeatGaps(root)).toEqual([]);
    touchHeartbeat(root, T0);
    expect(saved(root)).toEqual({ lastSeen: T0.toISOString(), gaps: [] });
  });

  test('two check-ins 2 hours apart in the build phase give one gap', () => {
    const root = setup('build');
    touchHeartbeat(root, T0);
    touchHeartbeat(root, later(2 * HOUR));
    expect(heartbeatGaps(root)).toEqual([{ from: T0.toISOString(), to: later(2 * HOUR).toISOString() }]);
    expect(saved(root).lastSeen).toBe(later(2 * HOUR).toISOString());
  });

  test('check-ins close together are not a gap, and exactly 10 minutes is not either', () => {
    const root = setup('build');
    touchHeartbeat(root, T0);
    touchHeartbeat(root, later(HEARTBEAT_GAP_MS));
    touchHeartbeat(root, later(HEARTBEAT_GAP_MS + 1000));
    expect(heartbeatGaps(root)).toEqual([]);
  });

  test('one second over 10 minutes is a gap', () => {
    const root = setup('build');
    touchHeartbeat(root, T0);
    touchHeartbeat(root, later(HEARTBEAT_GAP_MS + 1000));
    expect(heartbeatGaps(root)).toHaveLength(1);
  });

  test('a long silence outside the build phase is not a gap, but lastSeen still moves', () => {
    const root = setup('plan1');
    touchHeartbeat(root, T0);
    touchHeartbeat(root, later(5 * HOUR));
    expect(heartbeatGaps(root)).toEqual([]);
    expect(saved(root).lastSeen).toBe(later(5 * HOUR).toISOString());
  });

  test('gaps pile up in order', () => {
    const root = setup('build');
    touchHeartbeat(root, T0);
    touchHeartbeat(root, later(HOUR));
    touchHeartbeat(root, later(HOUR + MIN));
    touchHeartbeat(root, later(4 * HOUR));
    expect(heartbeatGaps(root).map((g) => g.to)).toEqual([later(HOUR).toISOString(), later(4 * HOUR).toISOString()]);
  });

  test('a file holding only lastSeen (as the exam writes it) counts as no gaps so far', () => {
    const root = setup('build');
    writeFileSync(file(root), JSON.stringify({ lastSeen: T0.toISOString() }));
    expect(heartbeatGaps(root)).toEqual([]);
    touchHeartbeat(root, later(2 * HOUR));
    expect(heartbeatGaps(root)).toEqual([{ from: T0.toISOString(), to: later(2 * HOUR).toISOString() }]);
  });

  test('a lastSeen in the future (clock change, or edited) is never a gap and is replaced by the real time', () => {
    const root = setup('build');
    writeFileSync(file(root), JSON.stringify({ lastSeen: later(9 * HOUR).toISOString() }));
    touchHeartbeat(root, T0);
    expect(heartbeatGaps(root)).toEqual([]);
    expect(saved(root).lastSeen).toBe(T0.toISOString());
  });

  test('a heartbeat file that is not valid is a plain error naming the file', () => {
    const root = setup('build');
    writeFileSync(file(root), JSON.stringify({ lastSeen: 'yesterday-ish' }));
    expect(() => touchHeartbeat(root, T0)).toThrow(/heartbeat\.json/);
    expect(() => heartbeatGaps(root)).toThrow(/heartbeat\.json/);
  });

  test.each(['{ broken', '', '{"version": 2}', 'null'])('a state.json that cannot be read (%j) does not stop the check-in: the gap is recorded', (text) => {
    const root = setup('build');
    touchHeartbeat(root, T0);
    writeFileSync(join(root, '.seam', 'state.json'), text);
    expect(() => touchHeartbeat(root, later(2 * HOUR))).not.toThrow();
    expect(heartbeatGaps(root)).toEqual([{ from: T0.toISOString(), to: later(2 * HOUR).toISOString() }]);
  });

  test('a short silence is still no gap when state.json cannot be read', () => {
    const root = setup('build');
    touchHeartbeat(root, T0);
    writeFileSync(join(root, '.seam', 'state.json'), '{ broken');
    touchHeartbeat(root, later(MIN));
    expect(heartbeatGaps(root)).toEqual([]);
  });
});
