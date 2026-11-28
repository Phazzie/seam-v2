// R62: the launchers beyond the default PATHEXT (`.cpl .pif .psm1 .psd1 .msi .msp .reg .url .appref-ms`), and the
// extensions in THIS machine's PATHEXT, read from the environment in src/config (`.cpl` is on some machines, and cmd.exe
// runs `vitest.cpl` from the current folder); and `.gitattributes`, which gives files filters and diff drivers, is config.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { asMain } from '../helpers/app.ts';
import { runnableExtensions } from '../../src/config/pathext.ts';
import { isCodeFile } from '../../src/lib/paths.ts';
import { reasonOf, scene, writes } from '../helpers/decide.ts';
import { project } from '../helpers/project.ts';

const p = project();
const MORE = ['cpl', 'pif', 'psm1', 'psd1', 'msi', 'msp', 'reg', 'url', 'appref-ms'];

afterEach(() => vi.unstubAllEnvs());

describe('R62: more launchers are code files', () => {
  test.each(MORE)('.%s', (ext) => {
    expect(isCodeFile(`vitest.${ext}`)).toBe(true);
    expect(isCodeFile(`tools/X.${ext.toUpperCase()}`)).toBe(true);
    expect(isCodeFile(`vitest.${ext}.`)).toBe(true);
    expect(p.at(`vitest.${ext}`)).toBe('app-code');
    expect(p.at(`src/deep/vitest.${ext}`)).toBe('app-code');
  });
  test.each(MORE.map((ext) => `vitest.${ext}.txt`).concat(MORE.map((ext) => `vitest.${ext}x`)))('%s is not', (path) => expect(isCodeFile(path)).toBe(false));
  test.each(['vitest.cpl', 'vitest.pif', 'a.psm1', 'a.psd1', 'a.msi', 'a.msp', 'a.reg', 'a.url', 'a.appref-ms'])('the main AI cannot write %s (it is not in the plan)', async (rel) => {
    const s = await scene();
    expect(await reasonOf(writes(s, rel, 'x\n', asMain()))).toMatch(/not in the plan/);
  });
});

describe('R62: the extensions in this machine\'s PATHEXT are code files', () => {
  test('read lower case, split on ;, trimmed; entries without a dot and empty ones are dropped', () => {
    vi.stubEnv('PATHEXT', ' .COM;.Exe ;;.FOO;BAR;.;.Baz-Qux;');
    expect([...runnableExtensions()].sort()).toEqual(['.baz-qux', '.com', '.exe', '.foo']);
  });
  test('not set (other systems), or empty: none', () => {
    vi.stubEnv('PATHEXT', '');
    expect(runnableExtensions().size).toBe(0);
  });
  test('a change is picked up (it is read when it is asked for)', () => {
    vi.stubEnv('PATHEXT', '.FOO');
    expect(isCodeFile('x.foo')).toBe(true);
    vi.stubEnv('PATHEXT', '.BAR');
    expect(isCodeFile('x.foo')).toBe(false);
    expect(isCodeFile('x.bar')).toBe(true);
  });
  test('every extension in it is code, in any case and any folder, and nothing else is', () => {
    vi.stubEnv('PATHEXT', '.COM;.EXE;.CPL;.FOO;.QUX-X');
    for (const path of ['vitest.foo', 'a/b/vitest.FOO', 'vitest.qux-x', 'x.Cpl', 'vitest.foo.', 'src\\x.foo']) expect(isCodeFile(path), path).toBe(true);
    for (const path of ['vitest.fooo', 'vitest.foo.txt', 'vitest', 'foo', '.foo.d/x', 'dir.foo/readme']) expect(isCodeFile(path), path).toBe(false);
    expect(p.at('vitest.foo')).toBe('app-code');
  });
  test('the main AI cannot write a file with one of them', async () => {
    vi.stubEnv('PATHEXT', '.COM;.EXE;.FOO');
    const s = await scene();
    expect(await reasonOf(writes(s, 'vitest.foo', 'x\n', asMain()))).toMatch(/not in the plan/);
    expect(await reasonOf(writes(s, 'src/deep/run.FOO', 'x\n', asMain()))).toMatch(/not in the plan/);
  });
  test.runIf(process.platform === 'win32')('this machine\'s own PATHEXT: there is one, and every extension in it is code', () => {
    const own = runnableExtensions();
    expect(own.size).toBeGreaterThan(0);
    for (const ext of own) expect(isCodeFile(`vitest${ext}`), ext).toBe(true);
  });
});

describe('R62: .gitattributes is a config file, at any depth', () => {
  test.each(['.gitattributes', 'src/.gitattributes', 'packages/a/b/.gitattributes', '.GitAttributes', 'src/.GITATTRIBUTES'])('%s', (path) => {
    expect(p.at(path)).toBe('config-file');
  });
  test.each(['gitattributes', '.gitattributes.bak', '.gitattributes.md', 'src/.gitattribute'])('%s is not', (path) => expect(p.at(path)).not.toBe('config-file'));
  test('the main AI cannot write it', async () => {
    const s = await scene();
    expect(await reasonOf(writes(s, '.gitattributes', '* filter=x\n', asMain()))).toMatch(/config files are frozen/);
    expect(await reasonOf(writes(s, 'src/.gitattributes', '*.ts diff=x\n', asMain()))).toMatch(/config files are frozen/);
  });
});
