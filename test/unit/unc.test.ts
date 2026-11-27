// Windows can name a local file through the network path of its own drive: \\localhost\C$\dir\file,
// \\127.0.0.1\C$\..., \\[::1]\C$\..., \\<this machine>\C$\..., and the \\?\UNC\ forms of each. Those
// must be judged exactly like C:\dir\file. Any other network path (another machine, or a share of this
// one such as \\localhost\Users\..., which is C:\Users\...) cannot be told apart from a local file
// without asking the network, so it is refused, before anything is looked up. The paths are only
// strings here: nothing has to exist.
import { existsSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { classify, rel, resolveReal } from '../../src/lib/paths.ts';
import { project } from '../helpers/project.ts';

const WIN = process.platform === 'win32';
const REFUSED = /cannot be checked, so it is refused/;
const addresses = Object.values(networkInterfaces()).flatMap((list) => list ?? []).filter((info) => !info.internal);
const ipv4 = addresses.find((info) => info.family === 'IPv4')?.address;
const ipv6 = addresses.find((info) => info.family === 'IPv6' && !info.address.startsWith('fe80'))?.address;

const LOCAL_HOSTS = [
  'localhost', 'LocalHost', 'localhost.', '127.0.0.1', '127.0.0.2', '::1', '0--1.ipv6-literal.net',
  '[::1]', '[0:0:0:0:0:0:0:1]', hostname(), hostname().toUpperCase(),
  ...(ipv4 ? [ipv4] : []),
  ...(ipv6 ? [`${ipv6.replace(/:/g, '-')}.ipv6-literal.net`, `[${ipv6}]`, `[${ipv6.toUpperCase()}]`] : []),
];

/** `C:\a\b` as the network path of this machine's C drive: `\\host\C$\a\b`, or the `\\?\UNC\` form. */
const viaShare = (host: string, local: string, long = false): string =>
  `${long ? '\\\\?\\UNC\\' : '\\\\'}${host}\\${local[0]}$${local.slice(2)}`;
/** Any other share: `\\host\share\rest`, or the `\\?\UNC\` form. */
const onShare = (host: string, share: string, rest: string, long = false): string =>
  `${long ? '\\\\?\\UNC\\' : '\\\\'}${host}\\${share}\\${rest}`;

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
    expect(classify(p.ctx, viaShare(host, join(p.root, 'CLAUDE.md')).replace(/\\/g, '/'))).toBe('claude-config');
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

  describe('any other network path is refused (R23)', () => {
    /** What follows `C:\Users\` in the project path, so `\\localhost\Users\<this>` really is the project. */
    const underUsers = /^[a-z]:\\Users\\(.*)$/i.exec(p.root)?.[1] ?? 'someone\\Temp\\project';
    const refusedPaths = (host: string): string[] => [
      onShare(host, 'Users', `${underUsers}\\.seam\\state.json`),
      onShare(host, 'Users', `${underUsers}\\CLAUDE.md`, true),
      onShare(host, 'Users', `${underUsers}\\src\\pricing\\total.ts`).replace(/\\/g, '/'),
      onShare(host, 'share', 'a\\b.ts'),
      onShare(host, 'ADMIN$', 'System32\\x.dll'),
      onShare(host, 'C$$', 'x'),
    ];

    test.each(['localhost', '127.0.0.1', '[::1]', hostname(), 'seam-no-such-host.invalid', 'localhost.evil.invalid', 'not-localhost', '127.0.0.1.evil.invalid'])(
      'host %s: every non-drive share is refused, by resolveReal and by classify, without a lookup', (host) => {
        const started = Date.now();
        for (const path of refusedPaths(host)) {
          expect(() => resolveReal(p.root, path), path).toThrow(REFUSED);
          expect(() => classify(p.ctx, path), path).toThrow(REFUSED);
          expect(rel(p.root, path), path).toBeNull(); // text only: it is not under the project
        }
        // Looking such a host up takes seconds; none of the above may touch the network.
        expect(Date.now() - started).toBeLessThan(1000);
      },
    );
    test('a foreign host\'s C$ is not this machine\'s C drive', () => {
      for (const host of ['seam-no-such-host.invalid', 'localhost.evil.invalid']) {
        expect(() => classify(p.ctx, viaShare(host, secret))).toThrow(REFUSED);
        expect(() => classify(p.ctx, viaShare(host, secret, true))).toThrow(REFUSED);
      }
    });
    test('the reason says what to do', () => {
      expect(() => resolveReal(p.root, onShare('localhost', 'Users', 'x'))).toThrow(/Use the drive path/);
    });

    // A project that lives on a network share can use that share: nothing else can.
    const usersShareExists = existsSync('\\\\localhost\\Users\\') && /^[a-z]:\\Users\\/i.test(p.root);
    test.runIf(usersShareExists)('a project rooted on \\\\localhost\\Users\\... may use that same share, and no other', () => {
      const ctx = { ...p.ctx, root: onShare('localhost', 'Users', underUsers) };
      expect(classify(ctx, onShare('localhost', 'Users', `${underUsers}\\.seam\\state.json`))).toBe('seam-records');
      expect(classify(ctx, onShare('LOCALHOST', 'users', `${underUsers}\\src\\a.ts`))).toBe('app-code');
      expect(() => classify(ctx, onShare('127.0.0.1', 'Users', `${underUsers}\\.seam\\state.json`))).toThrow(REFUSED);
      expect(() => classify(ctx, onShare('localhost', 'Other', 'x'))).toThrow(REFUSED);
    });
  });
});
