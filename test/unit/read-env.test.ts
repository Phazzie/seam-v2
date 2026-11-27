// R55: Read, Glob and Grep of `.env` and `.env.*` (except `.env.example`) are refused for every agent, the main AI
// included, so secrets stay out of the AI's context. The owner can open them. The cases cover what an agent would
// plausibly do: name the file, name it in a pattern, search it, or reach it through an absolute path.
import { beforeAll, describe, expect, test } from 'vitest';
import { asChecker, asMain, makeApp } from '../helpers/app.ts';
import { expectAllowed, expectDenied, pre } from '../helpers/calls.ts';
import type { Scene } from '../helpers/decide.ts';
import { call, reasonOf as hookReason } from '../helpers/inproc.ts';
import { asks, builder, globs, greps, isAllowed, reads, readScene, reasonOf } from '../helpers/read.ts';

const ENV = "env files hold secrets, so they aren't read into the AI's context; the owner can open them";

let s: Scene;
beforeAll(async () => {
  s = await readScene();
});

const everyone = [
  ['main', asMain()], ['builder', builder()], ['describer', { agent_id: 'd-1', agent_type: 'seam-v2:describer' }],
  ['checker', asChecker()], ['surveyor', { agent_id: 's-1', agent_type: 'seam-v2:surveyor' }], ['design', { agent_id: 'g-1', agent_type: 'seam-v2:design' }],
  ['a built-in agent', { agent_id: 'b-1', agent_type: 'general-purpose' }],
] as const;

describe.each(everyone)('R55 for %s', (_name, who) => {
  test.each(['.env', '.env.local', '.env.production', 'src/.env', 'src/.env.production', '.env.example.bak', '.env.development.local'])('a Read of %s is refused', (rel) => {
    expect(reasonOf(reads(s, rel, who))).toBe(ENV);
  });
  test('the same file spelled with .. or from another folder', () => {
    expect(reasonOf(reads(s, 'src/../.env', who))).toBe(ENV);
    expect(reasonOf(reads(s, 'src/pricing/../../.env.local', who))).toBe(ENV);
  });
  test.runIf(process.platform === 'win32')('a trailing dot or other letter case is the same file on Windows', () => {
    expect(reasonOf(reads(s, '.env.', who))).toBe(ENV);
    expect(reasonOf(reads(s, '.ENV.Local', who))).toBe(ENV);
  });
  test.each(['**/.env*', '.env', '**/.env.*', '.env.local', '{.env,.env.local}', '**/*.env', 'src/**/.env.production'])('a Glob of %s is refused, with a path or without', (pattern) => {
    expect(reasonOf(globs(s, pattern, undefined, who))).toBe(ENV);
    expect(reasonOf(globs(s, pattern, 'contracts', who))).toBe(ENV);
  });
  test('an absolute Glob pattern naming the file', () => {
    expect(reasonOf(globs(s, `${s.app.abs('.env').replace(/\\/g, '/')}`, undefined, who))).toBe(ENV);
    expect(reasonOf(globs(s, `${s.app.abs('src').replace(/\\/g, '/')}/**/.env.*`, 'contracts', who))).toBe(ENV);
  });
  test('a Grep of the file, or with a glob that names it', () => {
    expect(reasonOf(greps(s, '.env', who))).toBe(ENV);
    expect(reasonOf(greps(s, 'src/.env.production', who))).toBe(ENV);
    expect(reasonOf(greps(s, 'contracts', who, '.env*'))).toBe(ENV);
    expect(reasonOf(greps(s, undefined, who, '**/.env'))).toBe(ENV);
  });
  test('a read that names the env file in a second field still counts', () => {
    expect(reasonOf(asks(s, 'Grep', { pattern: 'x', path: s.app.abs('contracts'), file_path: s.app.abs('.env') }, who))).toBe(ENV);
  });
});

describe('R55 leaves the files that are not secrets alone', () => {
  const free = asMain();
  test.each(['.env.example', 'src/.env.example', '.envrc', 'src/config/env.ts', 'notes.md'])('a Read of %s by the main AI', (rel) => isAllowed(reads(s, rel, free)));
  test.each(['**/.env.example', '.env.example', '**/*.ts', '.envrc', '**/env.ts', '**/.environment'])('a Glob of %s by the main AI', (pattern) => isAllowed(globs(s, pattern, undefined, free)));
  test('a Grep in the project with no file named, or with another glob', () => {
    isAllowed(greps(s, undefined, free));
    isAllowed(greps(s, 'src', free, '*.ts'));
    isAllowed(greps(s, 'src', free, '.env.example'));
  });
  test('a builder still reads its own file, so R55 is not a blanket refusal', () => isAllowed(reads(s, 'src/pricing/total.ts', builder())));
  test('.env.example is not open to a builder for being an example (it is not in its allowlist)', () => {
    expect(reasonOf(reads(s, '.env.example', builder()))).toMatch(/isn't something a builder reads/);
  });
});

describe('R55 in the hook', () => {
  test('is refused by the hook in this process, and counted like any refusal', async () => {
    const app = await makeApp({ phase: 'build' });
    expect(hookReason(await call(app, pre('Read', { file_path: app.abs('.env') })))).toBe(ENV);
    expect(hookReason(await call(app, pre('Glob', { pattern: '**/.env*' })))).toBe(ENV);
  });

  test('is refused by the real bundled hook, in every phase, and the example file is not', async () => {
    const app = await makeApp({ phase: 'build' });
    app.writeRaw('.env', 'KEY=secret\n');
    app.writeRaw('.env.example', 'KEY=\n');
    expectDenied(await app.hook(pre('Read', { file_path: app.abs('.env') })), /env files hold secrets/);
    expectDenied(await app.hook(pre('Grep', { pattern: 'KEY', path: app.root, glob: '.env*' })), /env files hold secrets/);
    expectAllowed(await app.hook(pre('Read', { file_path: app.abs('.env.example') })));
    expectAllowed(await app.hook(pre('Read', { file_path: app.abs('notes.md') })));
  });
});
