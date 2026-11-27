// Test helper: ask `decideWrite` directly (in this process), about an app made by makeApp. The
// context is the one the hook builds from what is on disk, with the phase and the turn changed in
// memory so one app can stand for every phase. Nothing is written to disk by the guard. The decision is async (R47).
import { expect } from 'vitest';
import { buildCtx } from '../../src/guard/context.ts';
import { decideWrite } from '../../src/guard/write.ts';
import type { Ctx, Decision, HookInput, Phase } from '../../src/types.ts';
import { asBuilder, makeApp } from './app.ts';
import type { App, AppOptions, Who } from './app.ts';
import { TOTAL } from './code.ts';
import { edit, pre, write } from './calls.ts';

/** An app with the lock written (the snapshot is the tamper check's, not needed here) and its context. */
export interface Scene {
  app: App;
  ctx: Ctx;
}

export const BUILDER = 'builder-1';
export const TURN = { file: TOTAL, agentId: BUILDER };

export async function scene(opts: Partial<AppOptions> = {}): Promise<Scene> {
  const app = await makeApp({ phase: 'build', lock: true, snapshot: false, turn: TURN, ...opts });
  return { app, ctx: buildCtx(app.root, app.dataDir, app.pluginRoot, new Date()) };
}

/** The same project in another phase (and, if given, with another turn). */
export function inPhase(s: Scene, phase: Phase, turn?: Partial<{ file: string | null; agentId: string | null }>): Ctx {
  const old = s.ctx.state.turn;
  return { ...s.ctx, state: { ...s.ctx.state, phase, turn: { ...old, ...turn } } };
}

type Input = Parameters<typeof pre>[1];

/** A tool call as the guard gets it, from the app's folder. */
export const asInput = (input: Partial<HookInput> & { hook_event_name: string }, app: App): HookInput =>
  ({ cwd: app.root, session_id: 'test-session', ...input }) as HookInput;

/** What the guard says about `tool` with `toolInput`, called by `who`. */
export const ask = (s: Scene, tool: string, toolInput: Input, who: Who, ctx: Ctx = s.ctx): Promise<Decision> =>
  decideWrite(asInput(pre(tool, toolInput, who), s.app), ctx);

/** Write `content` to `rel` (a path from the app's folder). */
export const writes = (s: Scene, rel: string, content: string, who: Who, ctx: Ctx = s.ctx): Promise<Decision> =>
  decideWrite(asInput(write(s.app, rel, content, who), s.app), ctx);

/** Edit `oldText` to `newText` in `rel`. */
export const edits = (s: Scene, rel: string, oldText: string, newText: string, who: Who, ctx: Ctx = s.ctx): Promise<Decision> =>
  decideWrite(asInput(edit(s.app, rel, oldText, newText, who), s.app), ctx);

/** The builder whose turn it is, as the hook sees it. */
export const theBuilder = (): Who => asBuilder(BUILDER);

/** The reason of a refusal; fails the test when the call was allowed. */
export async function reasonOf(decision: Promise<Decision>): Promise<string> {
  const d = await decision;
  expect(d.kind, 'the guard allowed it').toBe('deny');
  return d.kind === 'deny' ? d.reason : '';
}

export const isAllowed = async (decision: Promise<Decision>): Promise<void> => {
  const d = await decision;
  expect(d, d.kind === 'deny' ? `the guard refused: ${d.reason}` : '').toEqual({ kind: 'allow' });
};
