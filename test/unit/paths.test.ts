import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { findProject, registerProject, rel, resolveReal } from '../../src/lib/paths.ts';
import { project, put, tempDir } from '../helpers/project.ts';

const WIN = process.platform === 'win32';
const norm = (p: string): string => resolveReal(p, '.');

describe('findProject and registerProject', () => {
  test('no .seam anywhere -> none', () => {
    expect(findProject(tempDir(), tempDir()).kind).toBe('none');
  });
  test('a folder inside a seam project finds the project root, however deep', () => {
    const { root, data } = project();
    expect(findProject(join(root, 'src', 'pricing'), data)).toEqual({ kind: 'seam', root: norm(root) });
    expect(findProject(root, data)).toEqual({ kind: 'seam', root: norm(root) });
  });
  test('registered root with .seam deleted -> missing', () => {
    const { root, data } = project();
    registerProject(root, data);
    rmSync(join(root, '.seam'), { recursive: true });
    expect(findProject(join(root, 'src'), data)).toEqual({ kind: 'missing', root: norm(root) });
    expect(findProject(root, data)).toEqual({ kind: 'missing', root: norm(root) });
  });
  test('deleting only state.json also counts as missing', () => {
    const { root, data } = project();
    registerProject(root, data);
    rmSync(join(root, '.seam', 'state.json'));
    expect(findProject(root, data).kind).toBe('missing');
  });
  test('an unregistered folder without .seam is none, not missing', () => {
    const { root, data } = project();
    rmSync(join(root, '.seam'), { recursive: true });
    expect(findProject(root, data).kind).toBe('none');
  });
  test('a folder next to a registered project is not part of it', () => {
    const { root, data } = project();
    registerProject(root, data);
    rmSync(join(root, '.seam'), { recursive: true });
    expect(findProject(`${root}-sibling`, data).kind).toBe('none');
  });
  test('the registry is projects.json, { "projects": [roots as resolveReal writes them] }, with no duplicates', () => {
    const a = project();
    const b = project();
    registerProject(a.root, a.data);
    registerProject(WIN ? a.root.toUpperCase() : a.root, a.data);
    registerProject(b.root, a.data);
    const saved: unknown = JSON.parse(readFileSync(join(a.data, 'projects.json'), 'utf8'));
    expect(saved).toEqual({ projects: [norm(a.root), norm(b.root)] });
  });
  describe('a project list that cannot be used (R17)', () => {
    const warnings = (data: string): string => (existsSync(join(data, 'registry-warnings.log')) ? readFileSync(join(data, 'registry-warnings.log'), 'utf8') : '');

    test('a corrupt list does not break a repo that is not a seam project: none, with a warning line', () => {
      const { root, data } = project();
      rmSync(join(root, '.seam'), { recursive: true });
      put(data, 'projects.json', '{ not json');
      expect(findProject(root, data)).toEqual({ kind: 'none' });
      expect(warnings(data)).toMatch(/projects\.json could not be used, so .* was treated as not a seam project: projects\.json is unreadable/);
      expect(warnings(data).endsWith('\n')).toBe(true);
    });
    test('every warning is one more line', () => {
      const { root, data } = project();
      rmSync(join(root, '.seam'), { recursive: true });
      put(data, 'projects.json', '{ not json');
      findProject(root, data);
      findProject(root, data);
      expect(warnings(data).trim().split('\n')).toHaveLength(2);
    });
    test('a seam project is found without reading the list at all: no error, no warning', () => {
      const { root, data } = project();
      put(data, 'projects.json', '{ not json');
      expect(findProject(root, data)).toEqual({ kind: 'seam', root: norm(root) });
      expect(warnings(data)).toBe('');
    });
    test('an entry that cannot be resolved makes the whole list unusable: none, with a warning', () => {
      const { root, data } = project();
      rmSync(join(root, '.seam'), { recursive: true });
      registerProject(root, data);
      put(data, 'projects.json', JSON.stringify({ projects: [norm(root), 'a\0b'] }));
      expect(findProject(root, data)).toEqual({ kind: 'none' });
      expect(warnings(data)).toMatch(/Could not work out/);
    });
    test.runIf(WIN)('a device-path entry is the same: none, with a warning', () => {
      const { root, data } = project();
      rmSync(join(root, '.seam'), { recursive: true });
      put(data, 'projects.json', JSON.stringify({ projects: ['\\\\?\\Volume{01234567-89ab-cdef-0123-456789abcdef}\\x'] }));
      expect(findProject(root, data)).toEqual({ kind: 'none' });
      expect(warnings(data)).toMatch(/device path/);
    });
    test('a list of the wrong shape is unusable too', () => {
      const { root, data } = project();
      rmSync(join(root, '.seam'), { recursive: true });
      put(data, 'projects.json', JSON.stringify({ projects: 'nope' }));
      expect(findProject(root, data)).toEqual({ kind: 'none' });
      expect(warnings(data)).toMatch(/projects\.json is invalid/);
    });
    test('a good list leaves no warnings file', () => {
      const { root, data } = project();
      registerProject(root, data);
      rmSync(join(root, '.seam'), { recursive: true });
      expect(findProject(root, data).kind).toBe('missing');
      expect(warnings(data)).toBe('');
    });
    test('registering still refuses to write over a list it cannot read', () => {
      const { root, data } = project();
      put(data, 'projects.json', '{ not json');
      expect(() => registerProject(root, data)).toThrow(/projects\.json is unreadable/);
      expect(readFileSync(join(data, 'projects.json'), 'utf8')).toBe('{ not json');
    });
  });

  test('a relative root is resolved once, from the current folder', () => {
    const { root, data } = project();
    const relativeRoot = relative(process.cwd(), root);
    registerProject(relativeRoot, data);
    const saved: unknown = JSON.parse(readFileSync(join(data, 'projects.json'), 'utf8'));
    expect(saved).toEqual({ projects: [norm(root)] });
    expect(findProject(relativeRoot, data)).toEqual({ kind: 'seam', root: norm(root) });
  });
});

describe('resolveReal and rel', () => {
  const { root } = project();
  const plain = resolveReal(root, 'src/pricing/total.ts');

  test('is absolute, uses forward slashes and is lower-cased only on Windows', () => {
    expect(plain).toMatch(/^([a-z]:)?\//i);
    expect(plain).not.toContain('\\');
    expect(plain === plain.toLowerCase()).toBe(WIN);
    expect(plain.endsWith('/src/pricing/total.ts')).toBe(true);
  });
  test.each(['./src/../src/pricing/total.ts', 'src/./pricing//total.ts'])(
    '%s resolves like src/pricing/total.ts', (p) => expect(resolveReal(root, p)).toBe(plain),
  );
  // Only Windows drops a trailing dot or space; elsewhere `total.ts.` is another name (see realpath-posix.test.ts).
  test.runIf(WIN)('a trailing dot or space resolves like src/pricing/total.ts', () => {
    for (const p of ['src/pricing/total.ts.', 'src/pricing/total.ts ', 'src./pricing/total.ts']) expect(resolveReal(root, p)).toBe(plain);
  });
  test.runIf(!WIN)('a trailing dot or space is part of the name', () => {
    expect(resolveReal(root, 'src/pricing/total.ts.')).toBe(`${plain}.`);
    expect(resolveReal(root, 'src/pricing/total.ts ')).toBe(`${plain} `);
  });
  test.runIf(WIN)('Windows spellings resolve like src/pricing/total.ts', () => {
    for (const p of ['SRC\\Pricing\\Total.ts', 'src\\pricing\\total.ts', 'Src/PRICING/total.TS', 'src/pricing/total.ts::$DATA', 'src/pricing/total.ts:stream:$DATA']) {
      expect(resolveReal(root, p)).toBe(plain);
    }
    expect(resolveReal('C:\\', join(root, 'src', 'pricing', 'total.ts'))).toBe(plain);
    expect(resolveReal(root, `\\\\?\\${join(root, 'src', 'pricing', 'total.ts')}`)).toBe(plain);
    expect(resolveReal(root, `//?/${join(root, 'src', 'pricing', 'total.ts').replace(/\\/g, '/')}`)).toBe(plain);
  });
  test.runIf(WIN)('a Windows device path that is not a drive path is refused, not guessed at', () => {
    expect(() => resolveReal(root, '\\\\?\\Volume{01234567-89ab-cdef-0123-456789abcdef}\\x.ts')).toThrow(/device path/);
  });
  test('an existing path comes back as its real location (a link to a folder is followed)', () => {
    const base = tempDir();
    put(base, 'real/inner/file.ts');
    symlinkSync(join(base, 'real'), join(base, 'link'), 'junction');
    expect(resolveReal(base, 'link/inner/file.ts')).toBe(resolveReal(base, 'real/inner/file.ts'));
    expect(resolveReal(base, 'link/not/made/yet.ts')).toBe(resolveReal(base, 'real/not/made/yet.ts'));
  });
  test('a link whose target is gone is followed to where a write would land', () => {
    const base = tempDir();
    put(base, 'real/keep.txt');
    mkdirSync(join(base, 'gone'));
    symlinkSync(join(base, 'gone'), join(base, 'dangling'), 'junction');
    rmSync(join(base, 'gone'), { recursive: true });
    expect(resolveReal(base, 'dangling/later.ts')).toBe(resolveReal(base, 'gone/later.ts'));
    expect(resolveReal(base, 'dangling')).toBe(resolveReal(base, 'gone'));
  });
  test('link/.. is read as this system reads it: Windows collapses it as text, Linux and macOS follow the link first', () => {
    const base = tempDir();
    put(base, 'real/inner/file.ts');
    symlinkSync(join(base, 'real', 'inner'), join(base, 'link'), WIN ? 'junction' : 'dir');
    expect(resolveReal(base, 'link/../x.ts')).toBe(resolveReal(base, WIN ? 'x.ts' : 'real/x.ts'));
  });
  test('a path with a NUL byte is an error', () => {
    expect(() => resolveReal(root, 'src/a\0b.ts')).toThrow(/Could not work out/);
  });
  test('rel gives repo-relative forward-slash text, "" for the root itself and null outside', () => {
    expect(rel(root, plain)).toBe('src/pricing/total.ts');
    expect(rel(root, root)).toBe('');
    expect(rel(root, join(root, 'a', '..', 'b.ts'))).toBe('b.ts');
    expect(rel(root, `${root}-sibling/x.ts`)).toBeNull();
    expect(rel(root, dirname(root))).toBeNull();
  });
});
