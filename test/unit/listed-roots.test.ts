// R46 (the R44 fix). A listed project root is skipped only when it is still a network path after Windows
// spellings are made ordinary. The admin-share alias of a local drive (//localhost/c$/...) is this machine's own
// folder: it is resolved locally and still matches, so deleting `.seam` in that project is "missing", not silence.
// A data folder on the network is a doubt: the list is not read from it, and in a seam project the call is refused.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { LIST_FILE, whySeamPossible } from '../../src/guard/inert.ts';
import { findProject, registerProject, resolveReal } from '../../src/lib/paths.ts';
import { staysOnNetwork } from '../../src/lib/pathcheck.ts';
import { makeApp } from '../helpers/app.ts';
import { expectDenied, pre, write } from '../helpers/calls.ts';
import { call, envFor, reasonOf } from '../helpers/inproc.ts';
import { put, tempDir } from '../helpers/project.ts';

const WIN = process.platform === 'win32';
const NETWORK = '//192.0.2.1/share/proj';
const NETWORK_DATA = '//192.0.2.1/share/data';
const read = (cwd: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Read', cwd, tool_input: {} });

/** What the path code was asked to look up on the file system (a spy that passes everything through). */
const looked = vi.hoisted(() => [] as string[]);
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const native = (path: string, ...rest: [never]): string => {
    looked.push(String(path));
    return real.realpathSync.native(path, ...rest);
  };
  return { ...real, realpathSync: Object.assign(real.realpathSync.bind(real), { native }) };
});
const askedAboutNetwork = (): string[] => looked.filter((path) => /^[\\/]{2}/.test(path));

/** `C:\a\b` as this machine's own admin share: `//localhost/c$/a/b`. */
const aliasOf = (dir: string): string => `//localhost/${dir[0].toLowerCase()}$${dir.slice(2).replace(/\\/g, '/')}`;

describe('staysOnNetwork', () => {
  test.each([NETWORK, '\\\\host\\share\\x', '//host/share'])('%s is a network path', (path) => {
    expect(staysOnNetwork(path)).toBe(true);
  });
  test.each(['C:\\proj', '/proj', 'relative/dir', '', '\\\\?\\C:\\proj', '\\\\?\\Volume{1}\\x'])('%s is not decided here', (path) => {
    expect(staysOnNetwork(path)).toBe(false);
  });
  test('a network path written wrongly is still network text (it is refused, never read as local)', () => {
    expect(staysOnNetwork('\\\\\\host\\share')).toBe(true);
  });
  test.runIf(WIN)('the admin share of this machine is a local folder', () => {
    for (const host of ['localhost', '127.0.0.1', 'LOCALHOST']) expect(staysOnNetwork(`//${host}/c$/Users/x`)).toBe(false);
    expect(staysOnNetwork('//someone-else/c$/Users/x')).toBe(true);
    expect(staysOnNetwork('//localhost/Users/x')).toBe(true); // a share of this machine we cannot place: still not read here
  });
});

describe('findProject and the list', () => {
  test('a network entry is skipped: never asked of the file system, and a later local entry still matches', async () => {
    const app = await makeApp({ phase: 'build' });
    rmSync(app.abs('.seam'), { recursive: true });
    const root = resolveReal(app.root, '.');
    writeFileSync(join(app.dataDir, LIST_FILE), JSON.stringify({ projects: [NETWORK, root] }));
    looked.length = 0;
    expect(findProject(app.root, app.dataDir)).toEqual({ kind: 'missing', root });
    expect(askedAboutNetwork()).toEqual([]);
  });

  test.runIf(WIN)('the admin-share alias of a local project is resolved locally: .seam deleted is "missing"', async () => {
    const app = await makeApp({ phase: 'build' });
    rmSync(app.abs('.seam'), { recursive: true });
    writeFileSync(join(app.dataDir, LIST_FILE), JSON.stringify({ projects: [aliasOf(app.root)] }));
    expect(findProject(app.abs('src'), app.dataDir)).toEqual({ kind: 'missing', root: resolveReal(app.root, '.') });
  });

  test('registering keeps a network entry exactly as written (it is not asked about, and not dropped)', async () => {
    const app = await makeApp({ phase: 'build' });
    writeFileSync(join(app.dataDir, LIST_FILE), JSON.stringify({ projects: [NETWORK] }));
    looked.length = 0;
    registerProject(app.root, app.dataDir);
    const saved = JSON.parse(readFileSync(join(app.dataDir, LIST_FILE), 'utf8')) as { projects: string[] };
    expect(saved.projects).toEqual([NETWORK, resolveReal(app.root, '.')]);
    expect(askedAboutNetwork()).toEqual([]);
  });

  test('a data folder on the network is not read: with no project found by walking it is a doubt, not silence', () => {
    looked.length = 0;
    expect(() => findProject(tempDir(), NETWORK_DATA)).toThrow(/plugin data folder .* network/);
    expect(askedAboutNetwork()).toEqual([]);
  });

  test('a seam project is still found by walking, without touching a data folder on the network', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(findProject(app.abs('src'), NETWORK_DATA)).toEqual({ kind: 'seam', root: resolveReal(app.root, '.') });
  });
});

describe('whySeamPossible and the list', () => {
  test.runIf(WIN)('the admin-share alias of a local project is not skipped: it is on the project list', async () => {
    const app = await makeApp({ phase: 'build' });
    rmSync(app.abs('.seam'), { recursive: true });
    const data = tempDir();
    put(data, LIST_FILE, JSON.stringify({ projects: [aliasOf(app.root)] }));
    expect(whySeamPossible(read(app.root), data)).toMatch(/is on the project list/);
  });

  test('a network entry is still skipped, and asked about nothing', () => {
    const data = tempDir();
    put(data, LIST_FILE, JSON.stringify({ projects: [NETWORK] }));
    looked.length = 0;
    expect(whySeamPossible(read(tempDir()), data)).toBeNull();
    expect(askedAboutNetwork()).toEqual([]);
  });

  test('a data folder on the network is a doubt (the list is not read from it), and is not asked about', () => {
    looked.length = 0;
    expect(whySeamPossible(read(tempDir()), NETWORK_DATA)).toMatch(/the plugin data folder .* starts with two separators/);
    expect(askedAboutNetwork()).toEqual([]);
  });

  test('a seam project found by walking is reported before the data folder is considered', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(whySeamPossible(read(app.root), NETWORK_DATA)).toMatch(/holds \.seam\/state\.json/);
  });
});

describe('the hook', () => {
  test.runIf(WIN)('a project listed by its admin-share alias, with .seam deleted: a Write from inside it is denied as missing', async () => {
    const app = await makeApp({ phase: 'build' });
    rmSync(app.abs('.seam'), { recursive: true });
    writeFileSync(join(app.dataDir, LIST_FILE), JSON.stringify({ projects: [aliasOf(app.root)] }));
    mkdirSync(app.abs('src'), { recursive: true });
    expectDenied(await app.hook(write(app, 'src/new.ts', 'x\n')), /missing/);
  });

  test('a seam project with its data folder on the network: refused, in words, and nothing is written to the network', async () => {
    const app = await makeApp({ phase: 'build' });
    looked.length = 0;
    const out = await call(app, write(app, 'notes.md', 'x\n'), { env: envFor(app, { CLAUDE_PLUGIN_DATA: NETWORK_DATA }) });
    expect(reasonOf(out)).toMatch(/blocked to be safe: CLAUDE_PLUGIN_DATA .* network/);
    expect(reasonOf(out)).toMatch(/not recorded/);
    expect(askedAboutNetwork()).toEqual([]);
  });

  test('a folder that is not a seam project, with its data folder on the network: left alone, with the cause on stderr', async () => {
    const app = await makeApp({ phase: 'build' });
    const out = await call(app, pre('Read', { file_path: join(tempDir(), 'x.ts') }), { cwd: tempDir(), env: envFor(app, { CLAUDE_PLUGIN_DATA: NETWORK_DATA }) });
    expect(out.stdout).toBe('');
    expect(out.note).toMatch(/plugin data folder .* network/);
  });
});
