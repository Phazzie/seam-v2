// R43 in the real bundle and in the source. (c) The cheap "is a seam project involved" check runs in the worker,
// under the clock: a stall inside it, even a busy loop, ends in the refusal for the event, within budget, never in
// a silent hang. (d) The cheap check and the full lookup get the paths a call names from one place. (f) The
// reason a seam project may be involved is written to stderr.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { whySeamPossible } from '../../src/guard/inert.ts';
import { resolveProject } from '../../src/guard/project.ts';
import { PATH_FIELDS } from '../../src/guard/request.ts';
import { makeApp } from '../helpers/app.ts';
import { expectAllowed, expectDenied, post, pre, write } from '../helpers/calls.ts';
import { tempDir } from '../helpers/project.ts';

/** A busy loop inside the cheap check, with the guard's limit cut to 1.5 s. */
const INERT_STALL = { SEAM_TEST_FORCE_INERT_HANG: '1', SEAM_TEST_TIMEOUT_MS: '1500' };

describe('R43 (c): a stall inside the cheap check is cut off by the clock', () => {
  test('in a folder that is not a seam project: a deny that says so, in a few seconds, not a hang and not silence', async () => {
    const app = await makeApp({ phase: 'build' });
    const elsewhere = tempDir();
    const r = await app.hook(pre('Write', { file_path: join(elsewhere, 'x.md'), content: 'x' }), { cwd: elsewhere, env: INERT_STALL });
    expectDenied(r, /took too long to decide/, { failClosed: true });
    expect(r.exitCode).toBe(0);
    expect(r.ms, 'the loop did not really run, so this tested nothing').toBeGreaterThan(1000);
    expect(r.ms).toBeLessThan(10_000);
  });

  test('after a tool, it is a block', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(post('Bash', { command: 'ls' }), { cwd: tempDir(), env: INERT_STALL });
    expect(r.blocked, 'the hook let it stand').toBe(true);
    expect(r.reason).toMatch(/took too long to decide, so it was blocked to be safe/);
    expect(r.exitCode).toBe(0);
    expect(r.ms).toBeGreaterThan(1000);
    expect(r.ms).toBeLessThan(10_000);
  });

  test('in a seam project too: the stall comes before everything, and is cut off the same way', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(write(app, 'notes.md', 'x'), { env: INERT_STALL });
    expectDenied(r, /took too long to decide/, { failClosed: true });
    expect(r.ms).toBeLessThan(10_000);
  });

  test('the switch only matters when set: without it the same call is fine', async () => {
    const app = await makeApp({ phase: 'build' });
    expectAllowed(await app.hook(pre('Read', { file_path: 'a.ts' }), { cwd: tempDir() }));
  });
});

describe('R43 (a): a stale network entry in the project list', () => {
  // 192.0.2.1 is reserved for documentation and answers nothing: asking it takes the whole 20 s on many networks.
  test('costs a call in a plain folder nothing: silent, and quick', async () => {
    const app = await makeApp({ phase: 'build' });
    writeFileSync(join(app.dataDir, 'projects.json'), JSON.stringify({ projects: ['//192.0.2.1/share/proj'] }));
    const r = await app.hook(pre('Read', { file_path: 'a.ts' }), { cwd: tempDir() });
    expectAllowed(r);
    expect(r.stderr).toBe('');
    expect(r.ms, 'something asked the host about the stale entry').toBeLessThan(5000);
  });
});

describe('R43 (f): the reason a seam project may be involved goes to stderr', () => {
  test('a call in a seam project says where it found one', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(pre('Read', { file_path: app.abs('notes.md') }));
    expectAllowed(r);
    expect(r.stderr).toMatch(/^seam guard: a seam project may be involved: .* holds \.seam\/state\.json\n$/);
  });

  test('a network path from a plain folder says it was not looked at, and the call is still left alone', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(pre('Read', { file_path: '\\\\evil-host\\share\\x.ts' }), { cwd: tempDir() });
    expectAllowed(r);
    expect(r.stderr).toMatch(/a seam project may be involved: the path .* starts with two separators/);
  });

  test('a call in a plain folder says nothing at all', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(pre('Read', { file_path: 'a.ts' }), { cwd: tempDir() });
    expectAllowed(r);
    expect(r.stderr).toBe('');
  });
});

describe('R43 (d): the cheap check and the full lookup name the same paths', () => {
  test.each(PATH_FIELDS)('%s is looked at by both', async (field) => {
    const app = await makeApp({ phase: 'build' });
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Read', cwd: tempDir(), tool_input: { [field]: app.abs('src/new.ts') } };
    expect(whySeamPossible(input, tempDir()), 'the cheap check missed it').toMatch(/holds/);
    expect(resolveProject(input, tempDir()), 'the full lookup missed it').toMatchObject({ kind: 'seam' });
  });

  const GUARD = resolve(import.meta.dirname, '../../src/guard');

  test('both import targetsOf from request.ts, and nothing else in the guard lists the fields', () => {
    for (const file of ['inert.ts', 'project.ts']) {
      expect(readFileSync(join(GUARD, file), 'utf8'), `${file} does not use the shared list`).toMatch(/import \{[^}]*\btargetsOf\b[^}]*\} from '\.\/request\.ts'/);
    }
    const others = [...readdirSync(GUARD).filter((f) => f.endsWith('.ts') && f !== 'request.ts').map((f) => join(GUARD, f)), join(GUARD, '../hook-worker.ts'), join(GUARD, '../hook.ts')];
    for (const file of others) {
      for (const field of PATH_FIELDS) {
        expect(readFileSync(file, 'utf8'), `${file} lists ${field} itself instead of using targetsOf`).not.toMatch(new RegExp(`['"]${field}['"]`));
      }
    }
  });
});
