// The main thread's cheap check (src/guard/inert.ts): is a seam project possible at all? It may only say
// "no" when it is sure; every doubt is a "look" and the worker decides.
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { STATE_PATH } from '../../src/formats/state.ts';
import { LIST_FILE, STATE_FILE, whySeamPossible } from '../../src/guard/inert.ts';
import { REGISTRY_FILE, registerProject } from '../../src/lib/registry.ts';
import { makeApp } from '../helpers/app.ts';
import { put, tempDir } from '../helpers/project.ts';

const read = (cwd: string, toolInput: Record<string, unknown> = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Read', cwd, tool_input: toolInput });

describe('the names it uses are the ones the worker uses', () => {
  test('state file and project list', () => {
    expect(STATE_FILE).toBe(STATE_PATH);
    expect(LIST_FILE).toBe(REGISTRY_FILE);
  });
});

describe('whySeamPossible: sure there is none', () => {
  test('a plain folder, no project list', () => {
    expect(whySeamPossible(read(tempDir()), tempDir())).toBeNull();
    expect(whySeamPossible(read(tempDir()), null)).toBeNull();
  });

  test('a plain folder and a file in another plain folder', () => {
    expect(whySeamPossible(read(tempDir(), { file_path: join(tempDir(), 'a.ts') }), tempDir())).toBeNull();
  });

  test('a project list that names other projects only', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(whySeamPossible(read(tempDir()), app.dataDir)).toBeNull();
  });
});

describe('whySeamPossible: a project may be involved', () => {
  test('the session folder is in a seam project, at its root or deeper', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(whySeamPossible(read(app.root), tempDir())).toMatch(/holds \.seam\/state\.json/);
    mkdirSync(app.abs('src/deep'), { recursive: true });
    expect(whySeamPossible(read(app.abs('src/deep')), tempDir())).toMatch(/holds \.seam\/state\.json/);
  });

  test.each(['file_path', 'notebook_path', 'path'])('a plain session folder but %s is in a seam project', async (field) => {
    const app = await makeApp({ phase: 'build' });
    expect(whySeamPossible(read(tempDir(), { [field]: app.abs('src/new.ts') }), tempDir())).toMatch(/holds/);
  });

  test('a relative path is taken from the session folder', async () => {
    const app = await makeApp({ phase: 'build' });
    const outside = join(app.root, '..');
    expect(whySeamPossible(read(outside, { file_path: join(app.root.split(/[\\/]/).pop() as string, 'a.ts') }), tempDir())).toMatch(/holds/);
  });

  test('a project on the list that has lost its records', async () => {
    const app = await makeApp({ phase: 'build' });
    rmSync(app.abs('.seam'), { recursive: true, force: true });
    expect(whySeamPossible(read(app.root), app.dataDir)).toMatch(/is on the project list/);
    expect(whySeamPossible(read(tempDir(), { file_path: app.abs('a.ts') }), app.dataDir)).toMatch(/is on the project list/);
  });

  test('a folder that is a link to a seam project (the real place is what counts)', async () => {
    const app = await makeApp({ phase: 'build' });
    const link = join(tempDir(), 'link');
    symlinkSync(app.root, link, 'junction');
    expect(whySeamPossible(read(link), tempDir())).toMatch(/holds/);
    expect(whySeamPossible(read(tempDir(), { file_path: join(link, 'src/a.ts') }), tempDir())).toMatch(/holds/);
  });
});

describe('whySeamPossible: when it cannot tell, it says so (and the worker looks)', () => {
  test.each([
    ['a project list that is not JSON', '{ nope'],
    ['a project list in another form', '{"projects": [1, 2]}'],
    ['a project list with other keys', '{"projects": [], "extra": true}'],
    ['a project list that is a list', '[]'],
  ])('%s', (_what, text) => {
    const data = tempDir();
    put(data, LIST_FILE, text);
    expect(whySeamPossible(read(tempDir()), data)).toMatch(/could not be told/);
  });

  test('a project list that is a folder', () => {
    const data = tempDir();
    mkdirSync(join(data, LIST_FILE));
    expect(whySeamPossible(read(tempDir()), data)).toMatch(/could not be told/);
  });

  test('a path it cannot resolve (a device path)', () => {
    if (process.platform !== 'win32') return;
    expect(whySeamPossible(read(tempDir(), { file_path: String.raw`\\?\GLOBALROOT\Device\x` }), tempDir())).toMatch(/could not be told/);
  });

  test('a project list with a root that is still listed after being registered twice is fine', async () => {
    const data = tempDir();
    const root = tempDir();
    registerProject(root, data);
    registerProject(root, data);
    writeFileSync(join(root, 'x'), '');
    expect(whySeamPossible(read(root), data)).toMatch(/is on the project list/);
  });
});
