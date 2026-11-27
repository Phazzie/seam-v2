// Windows reads odd spellings of a network path (`\\?\UNC\\localhost\C$\x`, `\\\localhost\C$\x`)
// as the ordinary one, while a plain reading of the text puts them inside the current drive. So the
// guard accepts only the exact form `\\host\share[\rest]` (also inside `\\?\UNC\`) and refuses every
// other path that starts with two or more separators. The paths are only strings: nothing has to exist.
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { classify, rel, resolveReal } from '../../src/lib/paths.ts';
import { settle } from '../../src/lib/realpath.ts';
import { project } from '../helpers/project.ts';

const WIN = process.platform === 'win32';
const REFUSED = /cannot be checked, so it is refused/;

/** The odd spellings of `\\host\share\rest` that Windows still reads as that network path. */
const oddSpellings = (host: string, share: string, rest: string): string[] => [
  `\\\\?\\UNC\\\\${host}\\${share}\\${rest}`,
  `\\\\?\\UNC\\\\\\${host}\\${share}\\${rest}`,
  `\\\\.\\UNC\\\\${host}\\${share}\\${rest}`,
  `//?/UNC//${host}/${share}/${rest.replace(/\\/g, '/')}`,
  `\\\\?\\unc\\\\${host}\\${share}\\${rest}`,
  `\\\\?\\UNC\\${host}\\\\${share}\\${rest}`,
  `\\\\\\${host}\\${share}\\${rest}`,
  `\\\\\\\\${host}\\${share}\\${rest}`,
  `///${host}/${share}/${rest.replace(/\\/g, '/')}`,
  `\\\\${host}\\\\${share}\\${rest}`,
  `/\\${host}/\\${share}\\${rest}`,
];
const INCOMPLETE = ['\\\\', '\\\\\\', '//', '\\\\host', '\\\\host\\', '//host/', '\\\\?\\UNC', '\\\\?\\UNC\\', '\\\\?\\UNC\\host', '\\\\?\\UNC\\host\\', '\\\\.\\UNC\\host'];

describe.runIf(WIN)('malformed network paths are refused (R24)', () => {
  const p = project();
  const under = p.root.slice(2); // `\Users\...`: the project without its drive letter
  const drive = `${p.root[0]}$`;

  test.each([
    ['this machine\'s C$', 'localhost', drive, `${under}\\.seam\\state.json`],
    ['this machine\'s host name', hostname(), drive, `${under}\\.seam\\state.json`],
    ['a Users share of this machine', 'localhost', 'Users', 'trap\\x\\.seam\\state.json'],
    ['a Users share by address', '127.0.0.1', 'Users', 'trap\\x\\CLAUDE.md'],
    ['another machine', 'seam-no-such-host.invalid', 'share', 'a\\.seam\\state.json'],
    ['another machine\'s C$', 'seam-no-such-host.invalid', drive, `${under}\\.seam\\state.json`],
  ])('every odd spelling of %s is refused, by resolveReal and by classify', (_name, host, share, rest) => {
    const started = Date.now();
    for (const path of oddSpellings(host, share, rest.replace(/^\\/, ''))) {
      expect(() => resolveReal(p.root, path), path).toThrow(REFUSED);
      expect(() => classify(p.ctx, path), path).toThrow(REFUSED);
      expect(() => rel(p.root, path), path).toThrow(REFUSED);
    }
    expect(Date.now() - started).toBeLessThan(1000); // none of it may look anything up
  });
  test.each(INCOMPLETE)('the incomplete form %s is refused', (path) => {
    expect(() => resolveReal(p.root, path), path).toThrow(REFUSED);
    expect(() => classify(p.ctx, path), path).toThrow(REFUSED);
  });
  test('a malformed path is refused as the project root, the data folder and the plugin folder too', () => {
    const odd = `\\\\?\\UNC\\\\localhost\\${drive}${under}`;
    expect(() => classify({ ...p.ctx, root: odd }, p.root)).toThrow(REFUSED);
    expect(() => classify({ ...p.ctx, dataDir: odd }, p.root)).toThrow(REFUSED);
    expect(() => classify({ ...p.ctx, pluginRoot: odd }, p.root)).toThrow(REFUSED);
  });

  describe('the well-formed spellings still work', () => {
    const secret = join(p.root, '.seam', 'state.json');
    test.each(['localhost', hostname(), '127.0.0.1', '[::1]'])('host %s: \\\\host\\C$\\... and \\\\?\\UNC\\host\\C$\\...', (host) => {
      expect(classify(p.ctx, `\\\\${host}\\${drive}${under}\\.seam\\state.json`)).toBe('seam-records');
      expect(classify(p.ctx, `\\\\?\\UNC\\${host}\\${drive}${under}\\.seam\\state.json`)).toBe('seam-records');
      expect(classify(p.ctx, `\\\\.\\UNC\\${host}\\${drive}${under}\\.seam\\state.json`)).toBe('seam-records');
      expect(classify(p.ctx, `//?/UNC/${host}/${drive}${under.replace(/\\/g, '/')}/.seam/state.json`)).toBe('seam-records');
    });
    test('extra separators after the share are harmless, as for any path', () => {
      expect(classify(p.ctx, `\\\\localhost\\${drive}${under}\\\\.seam\\\\state.json`)).toBe('seam-records');
      expect(classify(p.ctx, `\\\\?\\UNC\\localhost\\${drive}${under}\\\\.seam\\state.json`)).toBe('seam-records');
    });
    test('a single leading separator is a path on the current drive, as before', () => {
      expect(resolveReal(p.root, `${under}\\.seam\\state.json`)).toBe(resolveReal(p.root, secret));
      expect(resolveReal(p.root, `${under.replace(/\\/g, '/')}/.seam/state.json`)).toBe(resolveReal(p.root, secret));
    });
  });

  // A link whose target is a network path comes back from the file system in network form. Links to
  // a network path cannot be made without rights, so the check that runs on every real location is
  // tested alone.
  describe('settle: the check on every real location', () => {
    const none = (): boolean => false;
    test('a local drive\'s admin share is turned back into the drive path', () => {
      const real = `\\\\localhost\\${drive}${under}\\.seam\\state.json`;
      expect(settle(real, none)).toBe(resolve(p.root, '.seam', 'state.json'));
      expect(settle(`\\\\${hostname()}\\${drive}${under}`, none)).toBe(resolve(p.root));
    });
    test('any other share is refused unless the root\'s own', () => {
      expect(() => settle('\\\\localhost\\Users\\x', none)).toThrow(REFUSED);
      expect(() => settle('\\\\seam-no-such-host.invalid\\share\\x', none)).toThrow(REFUSED);
      const seen: string[] = [];
      expect(settle('\\\\Server\\Share\\a\\b', (share) => (seen.push(share), true))).toBe('\\\\Server\\Share\\a\\b');
      expect(seen).toEqual(['\\\\server\\share\\']);
      expect(() => settle('\\\\Server\\Other\\a', (share) => share === '\\\\server\\share\\')).toThrow(REFUSED);
    });
    test('a malformed or device path is refused whatever the root\'s share is', () => {
      const all = (): boolean => true;
      expect(() => settle('\\\\?\\UNC\\\\localhost\\C$\\x', all)).toThrow(REFUSED);
      expect(() => settle('\\\\\\localhost\\C$\\x', all)).toThrow(REFUSED);
      expect(() => settle('\\\\?\\Volume{01234567-89ab-cdef-0123-456789abcdef}\\x', all)).toThrow(REFUSED);
    });
    test('an ordinary drive path passes through', () => {
      expect(settle(resolve(p.root, 'src'), none)).toBe(resolve(p.root, 'src'));
    });
  });
});
