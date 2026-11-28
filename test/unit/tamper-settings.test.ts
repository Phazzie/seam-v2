// R73 (a): .claude/settings.local.json is Claude Code's own file, but only its `permissions` may change without the
// guard stepping in. Anything else in it (hooks, disableAllHooks, env, enabledPlugins, ...) can switch the guard off:
// it is put back, logged plainly, and the main AI is halted. A file that is not a JSON object is put back too.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { asBuilder, makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { post } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';
import { logText, problemsOf, quarantined, recordOf, stateOf } from '../helpers/tamper.ts';

const FILE = '.claude/settings.local.json';
const HALT = "Claude Code's settings were changed in a way that could switch the guard off";
const AUDIT = /\d\d:\d\d Claude Code updated permissions in \.claude\/settings\.local\.json\n/;
const BACK = `${FILE} was changed outside the rules and has been put back`;
const bash = post('Bash', { command: 'echo hi' });
const json = (value: unknown): string => `${JSON.stringify(value)}\n`;
const START = json({ permissions: { allow: ['Bash(git status)'] }, model: 'opus' });

const withFile = (text = START): Promise<App> => makeApp({ phase: 'build', lock: true, files: { [FILE]: text } });
const untouched = (app: App): void => {
  expect(stateOf(app).halted).toBeNull();
  expect(logText(app)).toMatch(AUDIT);
  expect(logText(app)).not.toMatch(/put back|halted/i);
};

describe('a change to permissions only is accepted, and logged', () => {
  test.each([
    ['an allow rule added', json({ permissions: { allow: ['Bash(git status)', 'Bash(ls)'] }, model: 'opus' })],
    ['a deny rule added', json({ permissions: { allow: ['Bash(git status)'], deny: ['Read(.env)'] }, model: 'opus' })],
    ['permissions emptied', json({ permissions: {}, model: 'opus' })],
    ['permissions removed altogether', json({ model: 'opus' })],
    ['the same file with its keys in another order (not a change at all)', json({ model: 'opus', permissions: { allow: ['Bash(git status)'] } })],
  ])('%s', async (_name, text) => {
    const app = await withFile();
    app.writeRaw(FILE, text);
    expect(await problemsOf(app, bash)).toEqual([]);
    expect(app.read(FILE)).toBe(text);
    untouched(app);
    expect(await problemsOf(app, post('Read', { file_path: 'x' }))).toEqual([]);
    expect(logText(app).match(/Claude Code updated permissions/g)).toHaveLength(1); // once: the record holds the new copy
  });

  test('after a file tool as after a command, and the record holds the new text', async () => {
    const app = await withFile();
    app.writeRaw(FILE, json({ permissions: { allow: ['Bash(ls)'] }, model: 'opus' }));
    expect(await problemsOf(app, post('Read', { file_path: 'x' }))).toEqual([]);
    expect(recordOf(app).files[FILE]).toBeDefined();
    untouched(app);
  });

  test('a new file that holds only permissions is accepted, and so is a file that is deleted when it held only permissions', async () => {
    const fresh = await makeApp({ phase: 'build', lock: true });
    fresh.writeRaw(FILE, json({ permissions: { allow: ['Bash(ls)'] } }));
    expect(await problemsOf(fresh, bash)).toEqual([]);
    expect(fresh.read(FILE)).toContain('Bash(ls)');
    expect(quarantined(fresh)).toEqual([]);
    untouched(fresh);
    const gone = await withFile(json({ permissions: { allow: ['Bash(ls)'] } }));
    rmSync(gone.abs(FILE));
    expect(await problemsOf(gone, bash)).toEqual([]);
    expect(existsSync(gone.abs(FILE))).toBe(false);
    untouched(gone);
  });
});

describe("R74: the owner's MCP server approvals are accepted like permissions, and logged", () => {
  const MCP_AUDIT = /\d\d:\d\d Claude Code updated MCP server approvals in \.claude\/settings\.local\.json\n/;
  test.each([
    ['enabledMcpjsonServers', { enabledMcpjsonServers: ['github'] }],
    ['disabledMcpjsonServers', { disabledMcpjsonServers: ['slack'] }],
    ['enableAllProjectMcpServers', { enableAllProjectMcpServers: true }],
  ])('%s', async (_key, change) => {
    const app = await withFile();
    const text = json({ permissions: { allow: ['Bash(git status)'] }, model: 'opus', ...change });
    app.writeRaw(FILE, text);
    expect(await problemsOf(app, bash)).toEqual([]);
    expect(app.read(FILE)).toBe(text);
    expect(stateOf(app).halted).toBeNull();
    expect(logText(app)).toMatch(MCP_AUDIT);
    expect(logText(app)).not.toMatch(/put back|halted/i);
  });

  test('a change to permissions and an MCP approval together is accepted, and both are logged', async () => {
    const app = await withFile();
    app.writeRaw(FILE, json({ permissions: { allow: ['Bash(ls)'] }, model: 'opus', enabledMcpjsonServers: ['github'] }));
    expect(await problemsOf(app, bash)).toEqual([]);
    expect(logText(app)).toMatch(/Claude Code updated permissions and MCP server approvals in \.claude\/settings\.local\.json/);
  });

  test('an MCP approval together with a setting that could switch the guard off is put back, and halts', async () => {
    const app = await withFile();
    app.writeRaw(FILE, json({ permissions: { allow: ['Bash(git status)'] }, model: 'opus', enabledMcpjsonServers: ['github'], disableAllHooks: true }));
    expect(await problemsOf(app, bash)).toEqual([`${BACK} (it changes "disableAllHooks", and only "permissions" and the MCP server approvals may be changed there)`]);
    expect(app.read(FILE)).toBe(START);
    expect(stateOf(app).halted).toBe(HALT);
    expect(logText(app)).not.toMatch(/updated/);
  });

  test('a new file that holds only MCP approvals is accepted', async () => {
    const fresh = await makeApp({ phase: 'build', lock: true });
    fresh.writeRaw(FILE, json({ enabledMcpjsonServers: ['github'] }));
    expect(await problemsOf(fresh, bash)).toEqual([]);
    expect(quarantined(fresh)).toEqual([]);
    expect(logText(fresh)).toMatch(MCP_AUDIT);
  });
});

describe('any other setting that changes is put back, and halts the main AI', () => {
  test.each([
    ['hooks', { hooks: { PreToolUse: [] } }], ['disableAllHooks', { disableAllHooks: true }], ['env', { env: { NODE_OPTIONS: '--require x' } }],
    ['enabledPlugins', { enabledPlugins: { 'seam-v2@local': false } }], ['model', { model: 'other' }], ['somethingNew', { somethingNew: 1 }],
  ])('%s', async (field, change) => {
    const app = await withFile();
    app.writeRaw(FILE, json({ permissions: { allow: ['Bash(git status)'] }, model: 'opus', ...change }));
    expect(await problemsOf(app, bash)).toEqual([`${BACK} (it changes "${field}", and only "permissions" and the MCP server approvals may be changed there)`]);
    expect(app.read(FILE)).toBe(START);
    expect(stateOf(app).halted).toBe(HALT);
    expect(logText(app)).toMatch(/Put back \.claude\/settings\.local\.json/);
    expect(logText(app)).not.toMatch(/updated permissions/);
  });

  test('permissions changed together with another setting: the whole change is put back', async () => {
    const app = await withFile();
    app.writeRaw(FILE, json({ permissions: { allow: ['Bash(ls)'] }, model: 'opus', hooks: {} }));
    expect(await problemsOf(app, bash)).toEqual([`${BACK} (it changes "hooks", and only "permissions" and the MCP server approvals may be changed there)`]);
    expect(app.read(FILE)).toBe(START);
    expect(stateOf(app).halted).toBe(HALT);
  });

  test('a setting that was removed counts as changed', async () => {
    const app = await withFile();
    app.writeRaw(FILE, json({ permissions: { allow: ['Bash(git status)'] } }));
    expect(await problemsOf(app, bash)).toEqual([`${BACK} (it changes "model", and only "permissions" and the MCP server approvals may be changed there)`]);
    expect(app.read(FILE)).toBe(START);
  });

  test('deleted while it held something besides permissions: put back', async () => {
    const app = await withFile();
    rmSync(app.abs(FILE));
    expect(await problemsOf(app, bash)).toEqual([`${FILE} was deleted outside the rules and has been put back (it changes "model", and only "permissions" and the MCP server approvals may be changed there)`]);
    expect(app.read(FILE)).toBe(START);
    expect(stateOf(app).halted).toBe(HALT);
  });

  test('a new file with hooks in it is moved aside, and halts', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(FILE, json({ permissions: {}, hooks: { PreToolUse: [] } }));
    expect(await problemsOf(app, bash)).toEqual([expect.stringMatching(/^\.claude\/settings\.local\.json is a new file that has no place there and has been moved aside/)]);
    expect(existsSync(app.abs(FILE))).toBe(false);
    expect(quarantined(app)).toEqual(['.claude/settings.local.json']);
    expect(stateOf(app).halted).toBe(HALT);
  });

  test('a builder that does it gets a strike on its file, not a halt', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { [FILE]: START }, turn: { file: TOTAL, agentId: 'builder-1' } });
    app.writeRaw(FILE, json({ hooks: {} }));
    expect(await problemsOf(app, post('Bash', { command: 'x' }, asBuilder('builder-1')))).toHaveLength(1);
    expect(stateOf(app)).toMatchObject({ halted: null, strikes: { [TOTAL]: 1 } });
  });
});

describe('a file that is not a JSON object is put back', () => {
  test.each([['broken JSON', '{ "permissions": '], ['empty', ''], ['an array', '[]\n'], ['null', 'null\n'], ['a string', '"x"\n'], ['a number', '7\n']])('%s', async (_name, text) => {
    const app = await withFile();
    writeFileSync(app.abs(FILE), text);
    expect(await problemsOf(app, bash)).toEqual([`${BACK} (it is not a JSON object)`]);
    expect(app.read(FILE)).toBe(START);
    expect(stateOf(app).halted).toBe(HALT);
    expect(logText(app)).not.toMatch(/updated permissions/);
  });

  test('a new one is moved aside', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw(FILE, '{ nope');
    expect(await problemsOf(app, bash)).toEqual([expect.stringMatching(/moved aside/)]);
    expect(existsSync(app.abs(FILE))).toBe(false);
    expect(stateOf(app).halted).toBe(HALT);
  });

  test('a file over 2 MB is put back without being read', async () => {
    const app = await withFile();
    writeFileSync(app.abs(FILE), `{"permissions":{"allow":["${'x'.repeat(3 * 1024 * 1024)}"]}}`);
    expect(await problemsOf(app, bash)).toEqual([`${BACK} (it is over 2 MB, so it was not read)`]);
    expect(app.read(FILE)).toBe(START);
  });
});

describe('the rest of .claude/ is as protected as before', () => {
  test('settings.json and the instruction files are put back whatever they hold', async () => {
    const app = await makeApp({ phase: 'build', lock: true, files: { '.claude/settings.json': json({ permissions: {} }), 'CLAUDE.md': 'rules\n' } });
    app.writeRaw('.claude/settings.json', json({ permissions: { allow: ['Bash(rm -rf /)'] } }));
    app.writeRaw('CLAUDE.md', 'no rules\n');
    expect(await problemsOf(app, bash)).toEqual(['.claude/settings.json was changed outside the rules and has been put back', 'CLAUDE.md was changed outside the rules and has been put back']);
    expect(stateOf(app).halted).toBe('the main AI changed a protected file: .claude/settings.json');
  });
});
