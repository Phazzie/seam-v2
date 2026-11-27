// The cheap check the worker makes first (src/guard/inert.ts): is a seam project possible at all? It may
// only say "no" when it is sure; every doubt is a "look" and the full lookup decides. It never resolves a
// network or device path (text that starts with two separators), looks for a project by walking before it
// reads the project list, and does not read a list that is too big (R43).
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { STATE_PATH } from '../../src/formats/state.ts';
import { LIST_FILE, LIST_MAX_BYTES, STATE_FILE, whySeamPossible } from '../../src/guard/inert.ts';
import { REGISTRY_FILE } from '../../src/lib/registry.ts';
import { resolveReal } from '../../src/lib/realpath.ts';
import { makeApp } from '../helpers/app.ts';
import { put, tempDir } from '../helpers/project.ts';

const read = (cwd: string, toolInput: Record<string, unknown> = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Read', cwd, tool_input: toolInput });
const UNC = '\\\\10.255.255.1\\share\\proj';
const TWO_SEPARATORS = /starts with two separators/;

/** A resolver that notices when it is asked about a path that starts with two separators (the network). */
function watching() {
  const asked: string[] = [];
  const resolve = vi.fn((root: string, path: string): string => {
    asked.push(root, path);
    return resolveReal(root, path);
  });
  return { resolve, networkAsked: (): string[] => asked.filter((text) => /^[\\/]{2}/.test(text)) };
}

describe('the names it uses are the ones the full lookup uses', () => {
  test('state file and project list', () => {
    expect(STATE_FILE).toBe(STATE_PATH);
    expect(LIST_FILE).toBe(REGISTRY_FILE);
  });
});

describe('whySeamPossible: sure there is none', () => {
  test('a plain folder, with and without a project list', async () => {
    expect(whySeamPossible(read(tempDir()), tempDir())).toBeNull();
    expect(whySeamPossible(read(tempDir()), null)).toBeNull();
    const app = await makeApp({ phase: 'build' });
    expect(whySeamPossible(read(tempDir()), app.dataDir)).toBeNull();
  });

  test('a plain folder and a file in another plain folder', () => {
    expect(whySeamPossible(read(tempDir(), { file_path: join(tempDir(), 'a.ts') }), tempDir())).toBeNull();
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
    const relative = join(app.root.split(/[\\/]/).pop() as string, 'a.ts');
    expect(whySeamPossible(read(join(app.root, '..'), { file_path: relative }), tempDir())).toMatch(/holds/);
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

describe('R43 (a): a network or device path is a doubt by its text, and is never resolved', () => {
  test.each([
    ['the session folder', (c: string) => read(UNC), 'the path'],
    ['a named path', (c: string) => read(c, { file_path: `${UNC}\\a.ts` }), 'the path'],
    ['a path written with forward slashes', (c: string) => read(c, { path: '//host/share/x' }), 'the path'],
    ['a device path', (c: string) => read(c, { file_path: '\\\\?\\GLOBALROOT\\Device\\x' }), 'the path'],
    ['a long path', (c: string) => read(c, { file_path: '\\\\?\\C:\\proj\\a.ts' }), 'the path'],
  ])('%s', (_what, make) => {
    const { resolve, networkAsked } = watching();
    expect(whySeamPossible(make(tempDir()), tempDir(), { resolve })).toMatch(TWO_SEPARATORS);
    expect(networkAsked(), 'a network path was handed to the path code').toEqual([]);
  });

  // The full lookup matches a listed network project only with a path that is itself on the network, and that
  // is a doubt already; resolving the entry would ask the host, so a stale entry (a host that never answers)
  // would cost every call in every folder the whole time limit. So it is skipped, not resolved.
  test('a listed network project is skipped, never resolved: a stale entry costs a plain folder nothing', () => {
    const data = tempDir();
    put(data, LIST_FILE, JSON.stringify({ projects: [UNC, '//192.0.2.1/share/proj'] }));
    const { resolve, networkAsked } = watching();
    expect(whySeamPossible(read(tempDir()), data, { resolve })).toBeNull();
    expect(networkAsked()).toEqual([]);
  });

  test('a listed project in the device or long-path form can be a local path, so it is a doubt (and not resolved)', () => {
    const data = tempDir();
    put(data, LIST_FILE, JSON.stringify({ projects: ['\\\\?\\C:\\proj'] }));
    const { resolve, networkAsked } = watching();
    expect(whySeamPossible(read(tempDir()), data, { resolve })).toMatch(/the listed project .* starts with two separators/);
    expect(networkAsked()).toEqual([]);
  });

  test('a network start with a listed network project is still a doubt (by the start)', () => {
    const data = tempDir();
    put(data, LIST_FILE, JSON.stringify({ projects: [UNC] }));
    expect(whySeamPossible(read(tempDir(), { file_path: `${UNC}\\a.ts` }), data)).toMatch(/the path .* starts with two separators/);
  });

  test('a path that leads to the network (a link or a mapped drive) is a doubt, and its folders are not walked', async () => {
    const real = tempDir();
    const resolve = vi.fn((root: string, path: string) => (path === '.' && root === real ? '//host/share/proj' : resolveReal(root, path)));
    expect(whySeamPossible(read(real), tempDir(), { resolve })).toMatch(/a path leads to \/\/host\/share\/proj/);
  });
});

describe('R43 (b): walk first, read the list only when the walk finds nothing', () => {
  test('a seam project found by walking never touches a list that is broken, too big, or names a network path', async () => {
    const app = await makeApp({ phase: 'build' });
    for (const text of ['{ not json', JSON.stringify({ projects: [UNC] }), ' '.repeat(LIST_MAX_BYTES + 10)]) {
      const data = tempDir();
      put(data, LIST_FILE, text);
      const { resolve, networkAsked } = watching();
      expect(whySeamPossible(read(app.root), data, { resolve })).toMatch(/holds \.seam\/state\.json/);
      expect(networkAsked()).toEqual([]);
    }
  });

  test('a stale network entry in the list does not cost a call that is in a seam project anything', async () => {
    const app = await makeApp({ phase: 'build' });
    writeFileSync(join(app.dataDir, LIST_FILE), JSON.stringify({ projects: [UNC, resolveReal(app.root, '.')] }));
    const { resolve, networkAsked } = watching();
    expect(whySeamPossible(read(app.root), app.dataDir, { resolve })).toMatch(/holds/);
    expect(networkAsked()).toEqual([]);
  });
});

describe('R43 (e): the project list is read only up to 1 MB', () => {
  /** A project list of about this many bytes (each entry is about 200). */
  const entries = (bytes: number): string => JSON.stringify({ projects: Array(Math.ceil(bytes / 200)).fill('c:/'.padEnd(200, 'x')) });

  test('a list over the limit is a doubt, and is not read', () => {
    const data = tempDir();
    put(data, LIST_FILE, entries(LIST_MAX_BYTES + 1000));
    expect(whySeamPossible(read(tempDir()), data)).toMatch(/could not be told .*bigger than 1048576 bytes/);
  });

  test('a list under the limit is read', () => {
    const data = tempDir();
    put(data, LIST_FILE, entries(LIST_MAX_BYTES / 16));
    expect(whySeamPossible(read(tempDir()), data)).toBeNull();
  });
});

describe('whySeamPossible: when it cannot tell, it says so (and the full lookup looks)', () => {
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

  test('a stall hook is called first (the tests use it to show the clock cuts a stall off)', () => {
    const stall = vi.fn(() => {
      throw new Error('stalled');
    });
    expect(whySeamPossible(read(tempDir()), null, { stall })).toMatch(/could not be told .*stalled/);
    expect(stall).toHaveBeenCalledOnce();
  });
});
