// proposedContent: the whole text a Write, Edit or MultiEdit would leave in the file, worked out
// from what the AI sent and what is on disk. An edit that cannot be applied is a refusal in words
// (Review Focus 4), never a throw and never a pass.
import { describe, expect, test } from 'vitest';
import { proposedContent } from '../../src/guard/write.ts';
import type { HookInput } from '../../src/types.ts';

const FILE = 'src/x.ts';
const call = (tool: string, toolInput: Record<string, unknown>): HookInput => ({
  hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { file_path: FILE, ...toolInput }, cwd: '/',
});
const edit = (oldText: string, newText: string, extra: Record<string, unknown> = {}) =>
  call('Edit', { old_string: oldText, new_string: newText, ...extra });
const text = (t: string) => ({ ok: true, text: t });
const refused = (reason: string | RegExp) => ({ ok: false, reason: typeof reason === 'string' ? reason : expect.stringMatching(reason) });

describe('Write', () => {
  test('is its content, whatever is on disk', () => {
    expect(proposedContent(call('Write', { content: 'new\n' }), 'old\n')).toEqual(text('new\n'));
    expect(proposedContent(call('Write', { content: 'new\n' }), null)).toEqual(text('new\n'));
  });
  test('an empty content is a real (empty) file', () => expect(proposedContent(call('Write', { content: '' }), null)).toEqual(text('')));
  test('content that is not text is refused', () => {
    expect(proposedContent(call('Write', { content: 5 }), null)).toEqual(refused("the content to write to src/x.ts isn't text"));
    expect(proposedContent(call('Write', {}), null)).toEqual(refused("the content to write to src/x.ts isn't text"));
  });
});

describe('Edit', () => {
  test('replaces the one place the text is', () => {
    expect(proposedContent(edit('b', 'B'), 'a b c\n')).toEqual(text('a B c\n'));
  });
  test('a text that is in the file twice needs replace_all, as the tool itself does', () => {
    expect(proposedContent(edit('x', 'y'), 'x x\n')).toEqual(refused(/appears 2 times in src\/x\.ts/));
    expect(proposedContent(edit('x', 'y', { replace_all: true }), 'x x\n')).toEqual(text('y y\n'));
  });
  test('replace_all with the text in the file once is the same as without', () => {
    expect(proposedContent(edit('x', 'y', { replace_all: true }), 'x z\n')).toEqual(text('y z\n'));
  });
  test('a replacement is taken literally: no $ patterns', () => {
    expect(proposedContent(edit('a', "$& $1 $$"), 'a\n')).toEqual(text('$& $1 $$\n'));
  });
  test('the text to replace is not there', () => {
    expect(proposedContent(edit('zzz', 'y'), 'a b c\n')).toEqual(refused("the text to replace wasn't found in src/x.ts"));
  });
  test('an empty text to replace is not found, not an insert at the start', () => {
    expect(proposedContent(edit('', 'y'), 'a\n')).toEqual(refused("the text to replace wasn't found in src/x.ts"));
  });
  test('a file that does not exist yet', () => {
    expect(proposedContent(edit('a', 'b'), null)).toEqual(refused("src/x.ts doesn't exist yet"));
  });
  test('an edit that is not made of text is refused', () => {
    expect(proposedContent(call('Edit', { old_string: 1, new_string: 'b' }), 'a')).toEqual(refused(/isn't text/));
    expect(proposedContent(call('Edit', { old_string: 'a' }), 'a')).toEqual(refused(/isn't text/));
  });
  test('Windows line endings in the file make no difference to the match', () => {
    expect(proposedContent(edit('a\nb', 'a\nB'), 'a\r\nb\r\nc\r\n')).toEqual(text('a\nB\nc\n'));
  });
  test('the file is named as it was written, whatever way that is', () => {
    const input = call('Edit', { file_path: 'C:\\x\\Y.ts', old_string: 'q', new_string: 'r' });
    expect(proposedContent(input, 'a')).toEqual(refused("the text to replace wasn't found in C:\\x\\Y.ts"));
  });
});

describe('MultiEdit', () => {
  const multi = (...edits: [string, string][]) =>
    call('MultiEdit', { edits: edits.map(([old_string, new_string]) => ({ old_string, new_string })) });
  test('applies its edits in order, each to the result of the one before', () => {
    expect(proposedContent(multi(['a', 'b'], ['b', 'c']), 'a\n')).toEqual(text('c\n'));
  });
  test('one edit that cannot be applied refuses all of them, naming which', () => {
    expect(proposedContent(multi(['a', 'b'], ['zzz', 'c']), 'a\n')).toEqual(refused("the text to replace wasn't found in src/x.ts (edit 2)"));
  });
  test('an edit may use replace_all', () => {
    const input = call('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b', replace_all: true }] });
    expect(proposedContent(input, 'a a\n')).toEqual(text('b b\n'));
  });
  test('a file that does not exist yet', () => {
    expect(proposedContent(multi(['a', 'b']), null)).toEqual(refused("src/x.ts doesn't exist yet"));
  });
  test('no edits, or edits that are not a list, are refused', () => {
    expect(proposedContent(call('MultiEdit', { edits: [] }), 'a')).toEqual(refused(/no edits/));
    expect(proposedContent(call('MultiEdit', { edits: 'a' }), 'a')).toEqual(refused(/no edits/));
    expect(proposedContent(call('MultiEdit', { edits: [5] }), 'a')).toEqual(refused(/isn't text/));
  });
});

describe('NotebookEdit and anything else', () => {
  test('a notebook edit is refused: its result cannot be worked out', () => {
    const input = { ...call('NotebookEdit', { new_source: 'x' }), tool_input: { notebook_path: 'a.ipynb', new_source: 'x' } };
    expect(proposedContent(input, '{}')).toEqual(refused("a.ipynb can't be changed with a notebook edit, so it can't be checked"));
  });
  test('a tool the guard does not know as a write is refused', () => {
    expect(proposedContent(call('Rename', {}), 'a')).toEqual(refused(/Rename/));
  });
});
