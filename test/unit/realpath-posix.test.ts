// How the path code reads a path on Linux and macOS, which differs from Windows in two ways that decide
// which file the guard classifies. A name is exactly what it says: `a.` and `a ` are not `a` (only Windows
// drops trailing dots and spaces). And the kernel follows a link before it applies the `..` after it, so
// `link/../x` sits beside what `link` points at, not beside `link`. This machine is Windows and cannot
// make links, so the platform is stubbed while the module loads, `node:path` is the POSIX one, and the
// file system's answers come from an in-memory file system that works like the kernel's (test/helpers/vfs.ts).
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Vfs } from '../helpers/vfs.ts';

const fake = vi.hoisted(() => ({ fs: null as Vfs | null }));
const answers = (): Vfs => {
  if (fake.fs === null) throw new Error('this test did not set up a file system');
  return fake.fs;
};
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return { ...actual.posix, posix: actual.posix, win32: actual.win32, default: actual.posix };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const native = (p: string): string => answers().realpath(p);
  return {
    ...actual,
    realpathSync: Object.assign(native, { native }),
    lstatSync: (p: string) => answers().lstat(p),
    readlinkSync: (p: string) => answers().readlink(p),
  };
});

const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor;
/** The path code as it loads on `platform` (decided when it loads, so the stub is lifted again once it has). */
async function loadOn(platform: NodeJS.Platform): Promise<typeof import('../../src/lib/realpath.ts')> {
  Object.defineProperty(process, 'platform', { ...hostPlatform, value: platform });
  try {
    vi.resetModules();
    return await import('../../src/lib/realpath.ts');
  } finally {
    Object.defineProperty(process, 'platform', hostPlatform);
  }
}
afterEach(() => {
  fake.fs = null;
  Object.defineProperty(process, 'platform', hostPlatform);
});

describe.each(['linux', 'darwin'] as const)('on %s', (platform) => {
  test('a trailing dot or space is part of the name, so "a", "a." and "a " are three names', async () => {
    const { tidyPart } = await loadOn(platform);
    expect(tidyPart('a.')).toBe('a.');
    expect(tidyPart('a ')).toBe('a ');
    expect(tidyPart('a')).toBe('a');
    expect(tidyPart('a. .')).toBe('a. .');
    expect(tidyPart('a:stream')).toBe('a:stream'); // a colon is an ordinary character here
  });

  test('a link called "a." is looked up as "a.", not as the file "a" next to it', async () => {
    const { resolveReal } = await loadOn(platform);
    fake.fs = new Vfs().dir('/proj').file('/proj/a').link('/proj/a.', '/outside/secret').dir('/outside').file('/outside/secret');
    expect(resolveReal('/proj', 'a')).toBe('/proj/a');
    expect(resolveReal('/proj', 'a.')).toBe('/outside/secret'); // trimmed to "a" it would be judged as the project's own file
    expect(resolveReal('/proj', 'a ')).toBe('/proj/a '); // not made yet, and not "a" either
    expect(resolveReal('/proj', 'dir./new.ts')).toBe('/proj/dir./new.ts');
  });

  test('a backslash is an ordinary character in a name, not a separator', async () => {
    const { resolveReal } = await loadOn(platform);
    fake.fs = new Vfs().dir('/proj');
    expect(resolveReal('/proj', 'a\\..\\x.ts')).toBe('/proj/a\\..\\x.ts');
  });

  describe('a link is followed before the .. after it is applied', () => {
    const tree = (): Vfs =>
      new Vfs()
        .dir('/proj').file('/proj/x')
        .link('/proj/link', '/secret/deep')
        .dir('/secret').dir('/secret/deep').file('/secret/x')
        .link('/secret/dangling', 'missing/new.ts') // relative to /secret, where the link really is
        .link('/proj/behind', '/proj/link/../q'); // a link whose own target goes through a link

    test('an existing file: link/../x is the file beside the link\'s target, not /proj/x', async () => {
      const { resolveReal, rel } = await loadOn(platform);
      fake.fs = tree();
      expect(resolveReal('/proj', 'link/../x')).toBe('/secret/x');
      expect(rel('/proj', resolveReal('/proj', 'link/../x'))).toBeNull(); // so it is outside the project, as the kernel sees it
      expect(resolveReal('/proj', 'x')).toBe('/proj/x');
    });

    test('a file about to be made: only the part that does not exist yet is joined as text', async () => {
      const { resolveReal } = await loadOn(platform);
      fake.fs = tree();
      expect(resolveReal('/proj', 'link/../made/later.ts')).toBe('/secret/made/later.ts');
      expect(resolveReal('/proj', 'nothing/../later.ts')).toBe('/proj/later.ts'); // nothing is there to follow
    });

    test('several hops, and a .. that leaves the folder altogether', async () => {
      const { resolveReal } = await loadOn(platform);
      fake.fs = tree();
      expect(resolveReal('/proj', 'link/../../proj/x')).toBe('/proj/x');
      expect(resolveReal('/proj', 'link/../deep/../x')).toBe('/secret/x');
      expect(resolveReal('/proj', './link//../x')).toBe('/secret/x');
    });

    test('the root itself may be given with a link in front of a ..', async () => {
      const { resolveReal } = await loadOn(platform);
      fake.fs = tree();
      expect(resolveReal('/proj/link/..', 'x')).toBe('/secret/x');
      expect(resolveReal('/proj/link/..', '.')).toBe('/secret');
    });

    test('a link that points at nothing: its target is read from the folder the link really sits in', async () => {
      const { resolveReal } = await loadOn(platform);
      fake.fs = tree();
      expect(resolveReal('/proj', 'link/../dangling')).toBe('/secret/missing/new.ts'); // not /proj/missing/new.ts
      expect(resolveReal('/proj', 'behind')).toBe('/secret/q'); // the target's own link/.. is followed too
    });

    test('a loop of links is refused, not followed forever', async () => {
      const { resolveReal } = await loadOn(platform);
      fake.fs = new Vfs().dir('/proj').link('/proj/a', '/proj/b').link('/proj/b', '/proj/a');
      expect(() => resolveReal('/proj', 'a')).toThrow(/Could not work out|Too many links/);
    });
  });
});

describe('on win32', () => {
  test('a trailing dot or space, and a :stream, are dropped from a name', async () => {
    const { tidyPart } = await loadOn('win32');
    expect(tidyPart('a.')).toBe('a');
    expect(tidyPart('a ')).toBe('a');
    expect(tidyPart('a. .')).toBe('a');
    expect(tidyPart('a:stream')).toBe('a');
    expect(tidyPart('a.ts.')).toBe('a.ts');
    expect(tidyPart('a')).toBe('a');
  });
});
