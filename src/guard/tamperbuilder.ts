// The turn builder's own file. A write the guard let through for it stays (the write decision already checked the
// text against the lock and the code rules before the tool ran). A change with no such go-ahead (the before-hook
// crashed, or the builder used another tool) stays only when it keeps the lock and the code rules, checked here;
// otherwise it is put back. That check needs the TypeScript parser, which is heavy, so it is loaded here and only
// here, and only for such a change. A file over 2 MB, or one that is not valid text, is not parsed.
import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { normalize } from '../lib/text.ts';
import { rel, resolveReal } from '../lib/paths.ts';
import { roleOf } from '../lib/roles.ts';
import type { Ctx, HookInput } from '../types.ts';
import { BIG_FILE, fold } from './tamperrecord.ts';
import type { Finding } from './tamperscan.ts';

/** What is wrong with the file at `abs` (a path from the repo root is `key`), or an empty list if it may stay. */
export type Verifier = (key: string, abs: string) => string[];

/** Is this the builder whose turn it is? */
export const isTurnBuilder = (ctx: Ctx, input: HookInput): boolean =>
  roleOf(input) === 'builder' && typeof input.agent_id === 'string' && input.agent_id === ctx.state.turn.agentId;

/** The builder's file as a path from the repo root (folded), or null when nobody has a turn. */
export function turnKey(ctx: Ctx): string | null {
  const { file } = ctx.state.turn;
  return file === null ? null : fold(rel(resolveReal(ctx.root, '.'), resolveReal(ctx.root, file)) ?? file);
}

const READABLE = new TextDecoder('utf-8', { fatal: true });

/**
 * The verifier for this call: null unless the turn builder made it, its own file is among the findings, and the
 * guard did not let that write through (`allowed`, folded paths).
 */
export async function verifierFor(ctx: Ctx, input: HookInput, found: Finding[], allowed: ReadonlySet<string>): Promise<Verifier | null> {
  const turn = turnKey(ctx);
  if (turn === null || allowed.has(turn) || !isTurnBuilder(ctx, input) || !found.some((f) => fold(f.key) === turn)) return null;
  const { lock, plan } = ctx;
  if (lock === null || plan === null) return () => ['there is no lock to check it against'];
  const [{ checkAgainstLock }, { codeRuleProblems }] = await Promise.all([import('../lib/lockcheck.ts'), import('../lib/rules.ts')]);
  return (key, abs) => {
    if (statSync(abs).size > BIG_FILE) return ['it is over 2 MB, so it was not read'];
    let text: string;
    try {
      text = normalize(READABLE.decode(readFileSync(abs)));
    } catch (err) {
      return [`it is not valid text (${(err as Error).message}), so it was not read`];
    }
    const lockKey = Object.keys(lock.files).find((k) => fold(k) === fold(key)) ?? key;
    const inApp = relative(ctx.appRoot, abs).replace(/\\/g, '/');
    return [...checkAgainstLock(lockKey, text, lock, plan), ...codeRuleProblems(inApp.startsWith('..') ? lockKey : inApp, text)];
  };
}
