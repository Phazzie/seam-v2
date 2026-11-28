// What a Write, Edit or MultiEdit would leave in a file, worked out from what the AI sent and what is on
// disk, so the guard can judge the whole text before anything is written. An edit that cannot be applied is
// a refusal in words (the tool would fail on it anyway), never a throw and never a pass.
import { normalize } from '../lib/text.ts';
import type { HookInput } from '../types.ts';

export type Proposed = { ok: true; text: string } | { ok: false; reason: string };

const no = (reason: string): Proposed => ({ ok: false, reason });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Replacement {
  from: string;
  to: string;
  all: boolean;
}

/** One edit, if it is made of text. Line endings are compared as the lock compares them (`\n`). */
function replacement(raw: unknown): Replacement | null {
  if (!isRecord(raw) || typeof raw.old_string !== 'string' || typeof raw.new_string !== 'string') return null;
  return { from: normalize(raw.old_string), to: normalize(raw.new_string), all: raw.replace_all === true };
}

/** Apply the edits one after another, each to what the one before left. `many` says which edit failed. */
function apply(file: string, current: string | null, edits: readonly Replacement[], many: boolean): Proposed {
  if (current === null) return no(`${file} doesn't exist yet`);
  let text = normalize(current);
  for (const [i, { from, to, all }] of edits.entries()) {
    const which = many ? ` (edit ${i + 1})` : '';
    const at = from === '' ? -1 : text.indexOf(from);
    if (at === -1) return no(`the text to replace wasn't found in ${file}${which}`);
    const times = text.split(from).length - 1;
    if (times > 1 && !all) {
      return no(`the text to replace appears ${times} times in ${file}${which}; include more around it, or replace all of them`);
    }
    // Sliced and joined, not String.replace: the new text is taken literally ($& and $1 mean nothing here).
    text = all ? text.split(from).join(to) : text.slice(0, at) + to + text.slice(at + from.length);
  }
  return { ok: true, text };
}

/**
 * The whole text the tool call would leave in the file. `currentText` is what is on disk now (null if the
 * file does not exist); a Write does not need it, an Edit or MultiEdit does. A NotebookEdit is always
 * refused: its result is not text the code rules can read.
 */
export function proposedContent(input: HookInput, currentText: string | null): Proposed {
  const args = input.tool_input ?? {};
  const file = [args.file_path, args.notebook_path].find((v): v is string => typeof v === 'string') ?? 'the file';
  switch (input.tool_name) {
    case 'Write':
      return typeof args.content === 'string' ? { ok: true, text: args.content } : no(`the content to write to ${file} isn't text`);
    case 'Edit': {
      const one = replacement(args);
      return one === null ? no(`the edit of ${file} isn't text`) : apply(file, currentText, [one], false);
    }
    case 'MultiEdit': {
      const list: unknown = args.edits;
      if (!Array.isArray(list) || list.length === 0) return no(`the edit of ${file} has no edits`);
      const edits = list.map(replacement).filter((e): e is Replacement => e !== null);
      if (edits.length !== list.length) return no(`an edit of ${file} isn't text`);
      return apply(file, currentText, edits, true);
    }
    case 'NotebookEdit':
      return no(`${file} can't be changed with a notebook edit, so it can't be checked`);
    default:
      return no(`${input.tool_name ?? 'this tool'} isn't a write the guard can read`);
  }
}
