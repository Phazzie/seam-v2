// The hook's main thread can often tell, cheaply, that a call has nothing to do with any seam project, and
// then the guard has to say nothing and need not start its worker (which costs about 55 ms and is not
// even needed to be inert). This is the same question the worker asks first (registry.ts: `findProject`),
// answered from the same places: `.seam/state.json` in the session folder, in each folder the call names,
// and in every folder above them, and the project list the plugin keeps. It does not load the state or
// path code (zod, git), only `resolveReal`, so the main thread stays small. When it cannot tell for any
// reason it says so and the worker decides: this check may only ever skip the worker when it is sure.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveReal } from '../lib/realpath.ts';
import type { HookInput } from '../types.ts';
import { describeError } from './output.ts';
import { targetsOf } from './request.ts';

/** The same names as STATE_PATH (formats/state.ts) and REGISTRY_FILE (lib/registry.ts); a test keeps them equal. */
export const STATE_FILE = '.seam/state.json';
export const LIST_FILE = 'projects.json';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The listed project roots as resolveReal spells them. No list is an empty list; a list in any other form throws. */
function listedRoots(dataDir: string | null): Set<string> {
  if (dataDir === null) return new Set();
  let text: string;
  try {
    text = readFileSync(join(dataDir, LIST_FILE), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw err;
  }
  const saved: unknown = JSON.parse(text.replace(/^﻿/, ''));
  const roots = isRecord(saved) && Object.keys(saved).length === 1 ? saved.projects : undefined;
  if (!Array.isArray(roots) || !roots.every((root) => typeof root === 'string')) {
    throw new Error(`${LIST_FILE} is not in the form {"projects": [...]}`);
  }
  return new Set(roots.map((root: string) => resolveReal(root, '.')));
}

/** The folder and every folder above it, nearest first. */
function ancestors(start: string): string[] {
  const folders = [start];
  for (let up = dirname(start); up !== folders.at(-1); up = dirname(up)) folders.push(up);
  return folders;
}

/**
 * Null when it is certain that no seam project is involved: nothing in the session folder, in any folder
 * the call names, or above them holds `.seam/state.json`, and none of them is on the project list.
 * Otherwise why the worker has to look (a seam project, a listed one, or a doubt).
 */
export function whySeamPossible(input: HookInput, dataDir: string | null): string | null {
  try {
    const listed = listedRoots(dataDir);
    const starts = [resolveReal(input.cwd, '.'), ...targetsOf(input).map((target) => resolveReal(input.cwd, target))];
    for (const dir of starts.flatMap(ancestors)) {
      if (existsSync(join(dir, STATE_FILE))) return `${dir} holds ${STATE_FILE}`;
      if (listed.has(dir)) return `${dir} is on the project list`;
    }
    return null;
  } catch (err) {
    return `it could not be told whether a seam project is involved (${describeError(err)})`;
  }
}
