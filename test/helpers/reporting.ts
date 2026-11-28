// Shared by the report tests: a project in a phase, its report as of a fixed moment, and the heartbeat as it was `agoMs` before it.
import { updateState } from '../../src/lib/store.ts';
import { renderReport } from '../../src/cli/report.ts';
import type { Phase } from '../../src/types.ts';
import { makeApp } from './app.ts';
import type { App } from './app.ts';
import { ctxOf } from './tamper.ts';

export const GREETING = 'src/greeting/Greeting.tsx';
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const NOW = new Date('2026-11-28T15:00:00');
export const iso = (agoMs: number): string => new Date(NOW.getTime() - agoMs).toISOString();

export const reportOf = (app: App, now: Date = NOW): string => renderReport(ctxOf(app), now);
export const setState = (app: App, change: Parameters<typeof updateState>[2]): void => void updateState(app.root, app.dataDir, change);
export const beat = (app: App, agoMs: number, gaps: { from: number; to: number }[] = []): void =>
  app.writeRaw('.seam/heartbeat.json', JSON.stringify({ lastSeen: iso(agoMs), gaps: gaps.map((g) => ({ from: iso(g.from), to: iso(g.to) })) }));
export const inPhase = (phase: Phase): Promise<App> => makeApp({ phase, lock: true });
