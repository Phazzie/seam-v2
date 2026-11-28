// `.claude/settings.local.json` is the one protected file Claude Code writes itself: when the owner answers "don't ask
// again" to a permission prompt, or approves an MCP server, it saves the answer there. So a change to it is accepted,
// but only when every top-level setting that changed is `permissions` or one of the three MCP approvals (R74:
// `enabledMcpjsonServers`, `disabledMcpjsonServers`, `enableAllProjectMcpServers`; none of them can switch a hook off).
// Anything else in that file can switch the guard off (`hooks`, `disableAllHooks`, `enabledPlugins`, `env`, a model or
// a setting that is not known yet), and a file that cannot be read as a JSON object may make Claude Code drop the whole
// file. Those are put back, and the run is halted.
import { readFileSync, statSync } from 'node:fs';
import { BIG_FILE, blobOf } from './tamperrecord.ts';
import type { Entry, Home } from './tamperrecord.ts';

/** The settings a change to the file may touch: the permissions, and the owner's answers about MCP servers. */
const PERMISSIONS = 'permissions';
const MCP_KEYS: ReadonlySet<string> = new Set(['enabledMcpjsonServers', 'disabledMcpjsonServers', 'enableAllProjectMcpServers']);

/** Why a halt follows a change that is not accepted. */
export const SWITCH_OFF = "Claude Code's settings were changed in a way that could switch the guard off";

type Settings = Record<string, unknown>;

/** The text as a settings object, or null if it is not JSON or not an object (an array, a string, null, a number). */
function parse(bytes: Buffer): Settings | null {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
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

/** What the check made of a change to the settings file: why it cannot be accepted (null if it can), and how to word the log line if it is. */
export interface SettingsVerdict { problem: string | null; updated: string }

const refused = (problem: string): SettingsVerdict => ({ problem, updated: '' });

/**
 * Why the change to the settings file, from what the record holds (`entry`, none if the file is new) to the file at
 * `abs` (null if it was deleted), cannot be accepted: a plain phrase for the reason, or null if every setting that
 * changed is `permissions` or an MCP approval. `updated` names what was updated, for the audit line ("permissions", or
 * "MCP server approvals", or both). A file over 2 MB is not read.
 */
export function checkSettings(home: Home, entry: Entry | undefined, abs: string | null): SettingsVerdict {
  let before: Settings = {};
  if (entry !== undefined) {
    const kept = blobOf(home, entry.hash);
    if (kept === null) return refused('no copy of its earlier text was kept, so the change cannot be checked');
    before = parse(kept) ?? {};
  }
  let after: Settings = {};
  if (abs !== null) {
    if (statSync(abs).size > BIG_FILE) return refused('it is over 2 MB, so it was not read');
    const parsed = parse(readFileSync(abs));
    if (parsed === null) return refused('it is not a JSON object');
    after = parsed;
  }
  const changed = changedKeys(before, after);
  const risky = changed.filter((key) => key !== PERMISSIONS && !MCP_KEYS.has(key));
  if (risky.length > 0) {
    return refused(`it changes ${risky.map((key) => `"${key}"`).join(', ')}, and only "${PERMISSIONS}" and the MCP server approvals may be changed there`);
  }
  const mcp = changed.some((key) => MCP_KEYS.has(key));
  const permissions = changed.includes(PERMISSIONS) || !mcp; // a file that was only reordered is logged as it always was
  return { problem: null, updated: [permissions ? 'permissions' : '', mcp ? 'MCP server approvals' : ''].filter((s) => s !== '').join(' and ') };
}
