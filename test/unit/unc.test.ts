// Windows can name a local file through the network path of its own drive: \\localhost\C$\dir\file,
// \\127.0.0.1\C$\..., \\<this machine>\C$\..., and the \\?\UNC\ forms of each. Those must be judged
// exactly like C:\dir\file. A UNC path on any other machine is somewhere else, and must be left
// alone without a network lookup. The paths are only strings here: nothing has to exist.
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { classify, rel, resolveReal } from '../../src/lib/paths.ts';
import { project } from '../helpers/project.ts';

const WIN = process.platform === 'win32';
const addresses = Object.values(networkInterfaces()).flatMap((list) => list ?? []).filter((info) => !info.internal);
const ipv4 = addresses.find((info) => info.family === 'IPv4')?.address;
const ipv6 = addresses.find((info) => info.family === 'IPv6' && !info.address.startsWith('fe80'))?.address;

const LOCAL_HOSTS = [
  'localhost', 'LocalHost', 'localhost.', '127.0.0.1', '127.0.0.2', '::1', '0--1.ipv6-literal.net',
  hostname(), hostname().toUpperCase(),
  ...(ipv4 ? [ipv4] : []),
  ...(ipv6 ? [`${ipv6.replace(/:/g, '-')}.ipv6-literal.net`] : []),
];

/** `C:\a\b` as the network path of this machine's C drive: `\\host\C$\a\b`, or the `\\?\UNC\` form. */
const viaShare = (host: string, local: string, long = false): string =>
  `${long ? '\\\\?\\UNC\\' : '\\\\'}${host}\\${local[0]}$${local.slice(2)}`;

describe.runIf(WIN)('UNC aliases of this machine\'s drives', () => {
  const p = project();
  const secret = join(p.root, '.seam', 'state.json');
  const code = join(p.root, 'src', 'pricing', 'total.ts');

  test.each(LOCAL_HOSTS)('host %s resolves like the plain path (every spelling)', (host) => {
    for (const spelled of [viaShare(host, code), viaShare(host, code, true), viaShare(host, code).replace(/\\/g, '/')]) {
      expect(resolveReal(p.root, spelled)).toBe(resolveReal(p.root, code));
    }
  });
  test.each(LOCAL_HOSTS)('host %s: a protected file is still protected, and a new file in a protected folder too', (host) => {
    expect(classify(p.ctx, viaShare(host, secret))).toBe('seam-records');
    expect(classify(p.ctx, viaShare(host, join(p.root, '.seam', 'never-made.json'), true))).toBe('seam-records');
    expect(classify(p.ctx, viaShare(host, join(p.root, 'plan', 'plan.json')))).toBe('plan');
    expect(classify(p.ctx, viaShare(host, code))).toBe('app-code');
  });
  test('the drive letter may be lower case, and the share may be the drive root', () => {
    expect(classify(p.ctx, viaShare('localhost', secret).replace('C$', 'c$'))).toBe('seam-records');
    expect(resolveReal(p.root, `\\\\localhost\\${p.root[0]}$`)).toBe(resolveReal(p.root, `${p.root[0]}:\\`));
  });
  test('the plugin and data folders are protected through their UNC names too', () => {
    expect(classify(p.ctx, viaShare('localhost', join(p.ctx.pluginRoot, 'dist', 'hook.mjs')))).toBe('plugin');
    expect(classify(p.ctx, viaShare('127.0.0.1', join(p.ctx.dataDir, 'projects.json')))).toBe('data-dir');
  });
  test('rel sees through the alias as well', () => {
    expect(rel(p.root, viaShare('localhost', code))).toBe('src/pricing/total.ts');
    expect(rel(viaShare('localhost', p.root), code)).toBe('src/pricing/total.ts');
  });
  test('a project whose own root is given as a UNC alias still classifies its files', () => {
    const ctx = { ...p.ctx, root: viaShare('localhost', p.root) };
    expect(classify(ctx, secret)).toBe('seam-records');
    expect(classify(ctx, code)).toBe('app-code');
  });

  describe('another machine', () => {
    test.each(['seam-no-such-host.invalid', 'localhost.evil.invalid', 'not-localhost', '127.0.0.1.evil.invalid'])('%s is outside, even for the repo path', (host) => {
      const started = Date.now();
      expect(classify(p.ctx, viaShare(host, secret))).toBe('outside');
      expect(classify(p.ctx, viaShare(host, secret, true))).toBe('outside');
      expect(resolveReal(p.root, viaShare(host, code))).toBe(`//${host.toLowerCase()}/c$${code.slice(2).replace(/\\/g, '/').toLowerCase()}`);
      expect(rel(p.root, viaShare(host, code))).toBeNull();
      // Looking such a host up takes seconds; none of the above may touch the network.
      expect(Date.now() - started).toBeLessThan(1000);
    });
    test('an ordinary share on another machine is outside', () => {
      expect(classify(p.ctx, '\\\\fileserver.invalid\\team\\notes.txt')).toBe('outside');
    });
  });
});
