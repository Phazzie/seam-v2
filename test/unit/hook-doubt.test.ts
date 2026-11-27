// Review fix, important 1: a path the guard cannot look at (the file system answers EBUSY or EPERM, as
// for C:\pagefile.sys or System Volume Information, or a link loop) is not known to be anything. In a
// folder that is not a seam project the guard must stay out of the way; only when the session folder or
// another path does show a seam project is the call refused for it. The lookup is replaced so it can fail.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { findProject } from '../../src/lib/paths.ts';
import type { ProjectLookup } from '../../src/lib/paths.ts';
import { makeApp } from '../helpers/app.ts';
import { pre } from '../helpers/calls.ts';
import { blocksOf, call, logOf, reasonOf } from '../helpers/inproc.ts';
import { tempDir } from '../helpers/project.ts';

vi.mock('../../src/lib/registry.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/registry.ts')>();
  return { ...real, findProject: vi.fn(real.findProject) };
});

const realLookup = (await vi.importActual<typeof import('../../src/lib/registry.ts')>('../../src/lib/registry.ts')).findProject;

/** The lookup answers as it really does, except that it fails with `code` for any path that contains `marker`. */
function failFor(marker: string, code: string, message = `Could not work out where it points: ${code}: the file is in use`): void {
  vi.mocked(findProject).mockImplementation((path: string, dataDir: string): ProjectLookup => {
    if (path.toLowerCase().includes(marker)) throw Object.assign(new Error(message), { code });
    return realLookup(path, dataDir);
  });
}
afterEach(() => vi.mocked(findProject).mockImplementation(realLookup));

describe('from a folder that is not a seam project', () => {
  test('a target that cannot be looked at (EBUSY) is left alone, and the cause is said on stderr', async () => {
    const app = await makeApp({ phase: 'build' });
    failFor('pagefile.sys', 'EBUSY');
    const out = await call(app, pre('Read', { file_path: join(tempDir(), 'pagefile.sys') }), { cwd: tempDir() });
    expect(out.stdout).toBe('');
    expect(out.exitCode).toBe(0);
    expect(out.note).toMatch(/could not be checked.*EBUSY.*left alone/);
  });

  test('a session folder that cannot be looked at (EPERM) is left alone', async () => {
    const app = await makeApp({ phase: 'build' });
    failFor('system volume information', 'EPERM');
    const out = await call(app, pre('Glob', { pattern: '*' }), { cwd: join(tempDir(), 'System Volume Information') });
    expect(out.stdout).toBe('');
    expect(out.note).toMatch(/EPERM/);
  });

  test('so is a path the path code refuses on purpose (a network path)', async () => {
    const app = await makeApp({ phase: 'build' });
    failFor('evil-host', 'EINVAL', 'The network path \\\\evil-host\\share\\x cannot be checked, so it is refused.');
    const out = await call(app, pre('Read', { file_path: join(tempDir(), 'evil-host', 'x') }), { cwd: tempDir() });
    expect(out.stdout).toBe('');
  });

  test('a lookup that fails for every path is still just silence', async () => {
    const app = await makeApp({ phase: 'build' });
    vi.mocked(findProject).mockImplementation(() => {
      throw Object.assign(new Error('EIO'), { code: 'EIO' });
    });
    expect((await call(app, pre('Read', { file_path: 'a.ts' }), { cwd: tempDir() })).stdout).toBe('');
  });
});

describe('when the session folder or another path does show a seam project', () => {
  test('the same unreadable target is refused as an internal error, and counted', async () => {
    const app = await makeApp({ phase: 'build' });
    failFor('pagefile.sys', 'EBUSY');
    const out = await call(app, pre('Read', { file_path: join(tempDir(), 'pagefile.sys') }));
    expect(reasonOf(out)).toMatch(/^seam guard hit an internal error and blocked to be safe: .*EBUSY/);
    expect(blocksOf(app)).toBe(1);
    expect(logOf(app.root)).toMatch(/Blocked: main tried Read on .*pagefile\.sys/);
  });

  test('a session folder that cannot be looked at, with a target in a seam project, is refused for the project', async () => {
    const app = await makeApp({ phase: 'build' });
    failFor('system volume information', 'EPERM');
    const out = await call(app, pre('Read', { file_path: app.abs('src/a.ts') }), { cwd: join(tempDir(), 'System Volume Information') });
    expect(reasonOf(out)).toMatch(/blocked to be safe: .*EPERM/);
    expect(blocksOf(app)).toBe(1);
  });

  test('a path the path code refuses on purpose is refused in its own plain words, not as an internal error', async () => {
    const app = await makeApp({ phase: 'build' });
    failFor('evil-host', 'EINVAL', 'The network path \\\\evil-host\\share\\x cannot be checked, so it is refused.');
    const out = await call(app, pre('Read', { file_path: join(tempDir(), 'evil-host', 'x') }));
    expect(reasonOf(out)).toMatch(/cannot be checked, so it is refused/);
    expect(reasonOf(out)).not.toMatch(/internal error|blocked to be safe/);
  });

  test('a project that lost its records still wins over a path that cannot be looked at', async () => {
    const app = await makeApp({ phase: 'build' });
    failFor('pagefile.sys', 'EBUSY');
    rmSync(app.abs('.seam'), { recursive: true, force: true });
    const out = await call(app, pre('Read', { file_path: join(tempDir(), 'pagefile.sys') }));
    expect(reasonOf(out)).toMatch(/records \(\.seam\) are missing/);
  });
});
