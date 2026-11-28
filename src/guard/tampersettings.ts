// `.claude/settings.local.json` is the one protected file Claude Code writes itself: when the owner answers "don't ask
// again" to a permission prompt it saves the answer there. So a change to it is accepted, but only when every
// top-level setting that changed is `permissions`. Anything else in that file can switch the guard off (`hooks`,
// `disableAllHooks`, `enabledPlugins`, `env`, a model or a setting that is not known yet), and a file that cannot
// be read as a JSON object may make Claude Code drop the whole file. Those are put back, and the run is halted.
import { readFileSync, statSync } from 'node:fs';
import { BIG_FILE, blobOf } from './tamperrecord.ts';
import type { Entry, Home } from './tamperrecord.ts';

/** The only setting a change to the file may touch. */
const ALLOWED_KEY = 'permissions';

/** Why a halt follows a change that is not accepted. */
export const SWITCH_OFF = "Claude Code's settings were changed in a way that could switch the guard off";

type Settings = Record<string, unknown>;

/** The text as a settings object, or null if it is not JSON or not an object (an array, a string, null, a number). */
function parse(bytes: Buffer): Settings | null {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Settings) : null;
  } catch (err) {
    if (err instanceof SyntaxError) return null; // not JSON; what it says about the text is not kept
    throw err;
  }
}

/** A value in one spelling whatever the order of its keys, so a file that was only reordered is not a change. */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value) ?? 'undefined';
  const record = value as Settings;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canon(record[key])}`).join(',')}}`;
}

/** The top-level settings that are not the same in the two files (present in one only, or with another value). */
function changedKeys(before: Settings, after: Settings): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => key in before !== key in after || canon(before[key]) !== canon(after[key]));
}

/**
 * Why the change to the settings file, from what the record holds (`entry`, none if the file is new) to the file at
 * `abs` (null if it was deleted), cannot be accepted: a plain phrase for the reason, or null if every setting that
 * changed is `permissions`. A file over 2 MB is not read.
 */
export function settingsProblem(home: Home, entry: Entry | undefined, abs: string | null): string | null {
  let before: Settings = {};
  if (entry !== undefined) {
    const kept = blobOf(home, entry.hash);
    if (kept === null) return 'no copy of its earlier text was kept, so the change cannot be checked';
    before = parse(kept) ?? {};
  }
  let after: Settings = {};
  if (abs !== null) {
    if (statSync(abs).size > BIG_FILE) return 'it is over 2 MB, so it was not read';
    const parsed = parse(readFileSync(abs));
    if (parsed === null) return 'it is not a JSON object';
    after = parsed;
  }
  const risky = changedKeys(before, after).filter((key) => key !== ALLOWED_KEY);
  return risky.length === 0 ? null : `it changes ${risky.map((key) => `"${key}"`).join(', ')}, and only "${ALLOWED_KEY}" may be changed there`;
}
