// Test helper: a throwaway seam project (a git repo holding the practice plan) and the guard
// context for it. Used by the path and classification tests; nothing here runs the guard.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll } from 'vitest';
import { loadPlan, parsePlan } from '../../src/formats/plan.ts';
import { parseState } from '../../src/formats/state.ts';
import { classify, resolveReal } from '../../src/lib/paths.ts';
import type { PathClass } from '../../src/lib/paths.ts';
import type { Ctx } from '../../src/types.ts';
import { FIXTURE } from './code.ts';

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

/** A new empty folder (real path, so it matches what the guard resolves), removed after the run. */
export function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'seam-paths-')));
  temps.push(dir);
  return dir;
}

/** Write `text` to `base/relPath`, making the folders. */
export function put(base: string, relPath: string, text = 'x\n'): void {
  mkdirSync(dirname(join(base, relPath)), { recursive: true });
  writeFileSync(join(base, relPath), text);
}

export interface Project {
  root: string;
  data: string;
  ctx: Ctx;
  /** The class of a repo-relative path, resolved the way the guard resolves it. */
  at: (relPath: string) => PathClass;
}

/**
 * A seam project in a temp folder. `planChanges` override top-level plan fields; `git` makes it a repo;
 * `root` puts it somewhere else (for example inside a bigger repo).
 */
export function project(planChanges: Record<string, unknown> = {}, git = true, root = tempDir()): Project {
  const data = tempDir();
  cpSync(FIXTURE, root, { recursive: true });
  if (git) execFileSync('git', ['init', '-q'], { cwd: root });
  put(root, '.seam/state.json', '{}');
  const plan = parsePlan({ ...loadPlan(FIXTURE), ...planChanges });
  const state = parseState({
    version: 1, phase: 'build', turn: { agentId: null, file: null, startedAt: null },
    strikes: {}, parked: [], approvals: [], blocks: 0, halted: null,
  });
  const ctx: Ctx = { root, appRoot: resolve(root, plan.appRoot), dataDir: data, pluginRoot: tempDir(), state, plan, lock: null, now: new Date() };
  return { root, data, ctx, at: (relPath) => classify(ctx, resolveReal(root, relPath)) };
}
