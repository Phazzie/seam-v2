// Which files the record holds the content of, and taking one file into the record as it is now (what a
// legitimate change, or a seam script's output, becomes). The record always lists the code files; it holds
// the content of the protected places, and of the planned code files from the lock on, or from the skeleton
// phase on, when the skeletons exist (R15).
import { relative, resolve } from 'node:path';
import { classify } from '../lib/paths.ts';
import type { PathClass } from '../lib/paths.ts';
import { PHASES } from '../types.ts';
import type { Ctx } from '../types.ts';
import { absOf, fold, measure } from './tamperrecord.ts';
import type { TamperRecord } from './tamperrecord.ts';
import { look } from './tamperscan.ts';

/** The places whose files the record holds, whatever the phase. */
const PROTECTED = new Set<PathClass>(['seam-records', 'claude-config', 'plan', 'legacy', 'tests', 'contracts', 'fixtures', 'config-file']);
const isProtected = (cls: PathClass): boolean => PROTECTED.has(cls);

const SKELETONS_FROM = PHASES.indexOf('skeleton');

/**
 * Is this planned code file one whose content is held? A function from a path from the repo root (the plan may
 * spell its paths from the app folder or from the repo root, and both count), true from the lock on or from the
 * skeleton phase on.
 */
export function frozenCode(ctx: Ctx): (key: string) => boolean {
  if (ctx.plan === null || (ctx.lock === null && PHASES.indexOf(ctx.state.phase) < SKELETONS_FROM)) return () => false;
  const planned = new Set(
    ctx.plan.seams.flatMap((seam) => seam.files).flatMap((file) =>
      [ctx.appRoot, ctx.root].map((base) => fold(relative(ctx.root, resolve(base, file.path)).replace(/\\/g, '/'))),
    ),
  );
  return (key) => planned.has(fold(key));
}

/**
 * Take the file at `key` (a path from the repo root) into the record as it is now: a protected file or a planned
 * code file has its content held, any other code file is listed, and a file that is gone is forgotten.
 */
export function takeIn(ctx: Ctx, rec: TamperRecord, key: string): void {
  const abs = absOf(ctx, key);
  if (look(abs) === null) {
    delete rec.files[key];
    rec.code = rec.code.filter((name) => name !== key);
    return;
  }
  const cls = classify(ctx, abs);
  if (isProtected(cls)) {
    rec.files[key] = measure(ctx, abs);
  } else if (cls === 'app-code') {
    if (!rec.code.includes(key)) rec.code.push(key);
    if (frozenCode(ctx)(key)) rec.files[key] = measure(ctx, abs);
  }
}
