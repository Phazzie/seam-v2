// Test helper: ask `decideCommand` directly (in this process) about a command, in an app made by makeApp.
// The decision is the guard's alone; nothing is run and nothing is written.
import { expect } from 'vitest';
import { decideCommand } from '../../src/guard/command.ts';
import type { Decision, Phase } from '../../src/types.ts';
import { asMain } from './app.ts';
import type { Who } from './app.ts';
import { pre } from './calls.ts';
import { asInput, inPhase, scene } from './decide.ts';
import type { Scene } from './decide.ts';

/** A project with no lock, in the build phase: what a command is judged in. */
export const commandScene = (): Promise<Scene> => scene({ lock: false, snapshot: false });

/** What the guard says about `command`, run from `cwd` (the project's folder by default) by `who` (the main AI by default), in `phase` (build by default). */
export function runs(s: Scene, command: string, opts: { who?: Who; tool?: 'Bash' | 'PowerShell'; cwd?: string; phase?: Phase; extra?: Record<string, unknown> } = {}): Decision {
  const input = asInput(pre(opts.tool ?? 'Bash', { command, ...opts.extra }, opts.who ?? asMain()), s.app);
  return decideCommand(opts.cwd === undefined ? input : { ...input, cwd: opts.cwd }, opts.phase === undefined ? s.ctx : inPhase(s, opts.phase));
}

/** The reason of a refusal; fails the test when the command was allowed. */
export function whyNot(s: Scene, command: string, opts: Parameters<typeof runs>[2] = {}): string {
  const d = runs(s, command, opts);
  expect(d.kind, `the guard allowed: ${command}`).toBe('deny');
  return d.kind === 'deny' ? d.reason : '';
}

/** Fails the test, with the reason, when the command was refused. */
export function expectRuns(s: Scene, command: string, opts: Parameters<typeof runs>[2] = {}): void {
  const d = runs(s, command, opts);
  expect(d, d.kind === 'deny' ? `the guard refused "${command}": ${d.reason}` : '').toEqual({ kind: 'allow' });
}
