// The first thing the hook's worker does: can it tell, cheaply, that a call has nothing to do with any seam
// project? If so the guard says nothing and never loads the state, plan and decision code (zod and the
// rest), which is most of what a hook run costs. It asks what the full lookup asks first (registry.ts,
// `findProject`) and in the same order: `.seam/state.json` in the session folder, in each folder the
// call names and in every folder above them, and only if none is found the project list the plugin keeps.
//
// It runs in the worker thread, under the hook's clock, because the file system can stall (a share that
// does not answer) and a stall on the main thread would outlive the 30 s Claude Code allows and fail open.
// For the same reason it never looks at a network or device path (text that starts with two separators,
// as a session folder, a named path, a listed project, or where a link leads): that is a doubt, settled by
// the full lookup, which is also under the clock. This check may only ever skip the full lookup when it is
// sure, so every doubt (an unreadable or oversized list, a path it cannot resolve) is a reason to look.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { staysOnNetwork } from '../lib/pathcheck.ts';
import { resolveReal } from '../lib/realpath.ts';
import type { HookInput } from '../types.ts';
import { describeError } from './output.ts';
import { targetsOf } from './request.ts';

/** The same names as STATE_PATH (formats/state.ts) and REGISTRY_FILE (lib/registry.ts); a test keeps them equal. */
export const STATE_FILE = '.seam/state.json';
export const LIST_FILE = 'projects.json';
/** A project list bigger than this is not read here; it is a doubt, and the full lookup reads it. */
export const LIST_MAX_BYTES = 1024 * 1024;

/** Text that starts with two separators: a network path, or `\\?\` / `\\.\` (Windows device and long paths). */
const NETWORK_TEXT = /^[\\/]{2}/;
/** The device and long-path forms, which can be a local path in another spelling. */
const EXTENDED_TEXT = /^[\\/]{2}[?.][\\/]/;

export interface InertOptions {
  /** Called first; a test makes it stall, to show that a stall here is cut off by the clock. */
  stall?: () => void;
  /** How a path is made real. Defaults to resolveReal; a test passes one that notices network paths. */
  resolve?: (root: string, path: string) => string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The listed project roots as written in the list. No list is an empty list; one that is too big or in another form throws. */
function listedRoots(dataDir: string | null): string[] {
  if (dataDir === null) return [];
  const file = join(dataDir, LIST_FILE);
  let text: string;
  try {
    if (statSync(file).size > LIST_MAX_BYTES) throw new Error(`${LIST_FILE} is bigger than ${LIST_MAX_BYTES} bytes`);
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const saved: unknown = JSON.parse(text.replace(/^﻿/, ''));
  const roots = isRecord(saved) && Object.keys(saved).length === 1 ? saved.projects : undefined;
  if (!Array.isArray(roots) || !roots.every((root) => typeof root === 'string')) {
    throw new Error(`${LIST_FILE} is not in the form {"projects": [...]}`);
  }
  return roots;
}

/** The folder and every folder above it, nearest first. */
function ancestors(start: string): string[] {
  const folders = [start];
  for (let up = dirname(start); up !== folders.at(-1); up = dirname(up)) folders.push(up);
  return folders;
}

const networkReason = (text: string, what: string): string =>
  `${what} ${text} starts with two separators (a network or device path), so it is not looked at here`;

/**
 * Null when it is certain that no seam project is involved. Otherwise why the full lookup has to run: a
 * seam project (or a listed one) is involved, or something could not be settled here.
 */
export function whySeamPossible(input: HookInput, dataDir: string | null, options: InertOptions = {}): string | null {
  const resolve = options.resolve ?? resolveReal;
  try {
    options.stall?.();
    const named = targetsOf(input);
    const sessionText = [input.cwd, ...named];
    const network = sessionText.find((text) => NETWORK_TEXT.test(text));
    if (network !== undefined) return networkReason(network, 'the path');
    const starts = [resolve(input.cwd, '.'), ...named.map((target) => resolve(input.cwd, target))];
    const real = starts.find((start) => NETWORK_TEXT.test(start));
    if (real !== undefined) return networkReason(real, 'a path leads to');
    const folders = new Set(starts.flatMap(ancestors));
    for (const dir of folders) {
      if (existsSync(join(dir, STATE_FILE))) return `${dir} holds ${STATE_FILE}`;
    }
    // Only now, with no project found by walking, is the list read (the same order the full lookup uses). It is
    // not read from a data folder on the network (that would ask its host): not knowing is a doubt (R46).
    if (dataDir !== null && staysOnNetwork(dataDir)) return networkReason(dataDir, 'the plugin data folder');
    for (const root of listedRoots(dataDir)) {
      if (EXTENDED_TEXT.test(root)) return networkReason(root, 'the listed project');
      // A listed network project is written by registerProject in its canonical `//host/share/...` form, and the
      // full lookup only ever matches it with a path that is itself on the network. Such a path is a doubt above,
      // so this entry cannot change the answer, and resolving it would ask the host (a stale entry for a host
      // that does not answer would cost every call, in every folder, the whole time limit). It is skipped only
      // while it is still a network path once Windows spellings are made ordinary (R46): `//localhost/c$/x` is
      // this machine's own folder, so it is resolved and checked locally like any other.
      if (staysOnNetwork(root)) continue;
      const listed = resolve(root, '.');
      if (NETWORK_TEXT.test(listed)) return networkReason(listed, 'the listed project leads to');
      if (folders.has(listed)) return `${listed} is on the project list`;
    }
    return null;
  } catch (err) {
    return `it could not be told whether a seam project is involved (${describeError(err)})`;
  }
}
