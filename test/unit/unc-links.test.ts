// When the file system answers a lookup with a network path (a link whose target is one), that answer
// is checked like any other: this machine's own drive is mapped back to `C:\...`, anything else is
// refused. Such a link cannot be made without special rights, so the file system's answer is faked.
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { classify, resolveReal } from '../../src/lib/paths.ts';
import { project } from '../helpers/project.ts';

const fake = vi.hoisted(() => ({ answers: new Map<string, string>() }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const native = (p: string): string => fake.answers.get(p) ?? actual.realpathSync.native(p);
  return { ...actual, realpathSync: Object.assign((...args: Parameters<typeof actual.realpathSync>) => actual.realpathSync(...args), { native }) };
});

const WIN = process.platform === 'win32';
const REFUSED = /cannot be checked, so it is refused/;

describe.runIf(WIN)('a link that leads to a network path', () => {
  const p = project();
  const link = join(p.root, 'link');
  const under = p.root.slice(2);
  const leadsTo = (target: string): void => {
    fake.answers.clear();
    fake.answers.set(link, target);
  };

  test('to this machine\'s own drive: it comes back as the drive path, and is judged for what it is', () => {
    leadsTo(`\\\\localhost\\${p.root[0]}$${under}\\.seam`);
    expect(resolveReal(p.root, 'link/state.json')).toBe(resolveReal(p.root, '.seam/state.json'));
    expect(classify(p.ctx, join(link, 'state.json'))).toBe('seam-records');
    expect(classify(p.ctx, join(link, 'not-made-yet.json'))).toBe('seam-records');
  });
  test.each([
    ['a share of this machine', '\\\\localhost\\Users\\x'],
    ['another machine', '\\\\seam-no-such-host.invalid\\share\\x'],
    ['another machine\'s C$', '\\\\seam-no-such-host.invalid\\C$\\x'],
    ['a malformed network path', '\\\\\\localhost\\C$\\x'],
    ['a device path', '\\\\?\\Volume{01234567-89ab-cdef-0123-456789abcdef}\\x'],
  ])('to %s: refused', (_name, target) => {
    leadsTo(target);
    expect(() => resolveReal(p.root, 'link/state.json')).toThrow(REFUSED);
    expect(() => classify(p.ctx, join(link, 'state.json'))).toThrow(REFUSED);
  });
  test('a drive letter that is itself a mapped share counts as the root\'s own share', () => {
    // The root answers with its network form, as a mapped drive does; paths below it do too.
    fake.answers.clear();
    fake.answers.set(p.root, '\\\\fileserver\\team\\project');
    fake.answers.set(link, '\\\\fileserver\\team\\project\\inner');
    expect(resolveReal(p.root, '.')).toBe('//fileserver/team/project');
    expect(resolveReal(p.root, 'link/x.ts')).toBe('//fileserver/team/project/inner/x.ts');
    fake.answers.set(link, '\\\\fileserver\\other\\project\\inner');
    expect(() => resolveReal(p.root, 'link/x.ts')).toThrow(REFUSED);
  });
});
