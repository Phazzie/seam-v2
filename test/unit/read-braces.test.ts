// R78 (Codex on PR #23): the env-file check on a Glob pattern or a Grep glob looked only at the last piece after a separator, so
// `{.env.local,src/*.ts}` was read as `*.ts}` and allowed. Every alternative a brace stands for (nested ones too) is checked now.
import { beforeAll, describe, expect, test } from 'vitest';
import { alternatives } from '../../src/lib/braces.ts';
import { asChecker, asMain } from '../helpers/app.ts';
import type { Scene } from '../helpers/decide.ts';
import { globs, greps, isAllowed, reasonOf, readScene } from '../helpers/read.ts';

const ENV = "env files hold secrets, so they aren't read into the AI's context; the owner can open them";

let s: Scene;
beforeAll(async () => {
  s = await readScene();
});

describe('alternatives: what the braces of a glob stand for', () => {
  test.each([
    ['*.ts', ['*.ts']],
    ['{a,b}', ['a', 'b']],
    ['{.env.local,src/*.ts}', ['.env.local', 'src/*.ts']],
    ['x/{a,b}/y', ['x/a/y', 'x/b/y']],
    ['{a,{b,c}}', ['a', 'b', 'c']],
    ['{a,b}{c,d}', ['ac', 'ad', 'bc', 'bd']],
    ['{a}', ['a']],
    ['{a,}', ['a', '']],
    ['{a,b', ['{a,b']],
    ['a}', ['a}']],
    ['', ['']],
  ])('%j', (glob, expected) => {
    expect([...(alternatives(glob) ?? [])].sort()).toEqual([...expected].sort());
  });

  test('a glob that would make too many alternatives is not expanded at all (the caller refuses it)', () => {
    expect(alternatives('{a,b}'.repeat(12))).toBeNull();
  });
});

describe.each([['main', asMain()], ['checker', asChecker()]])('R78 for %s: a brace that holds an env file is refused', (_name, who) => {
  test.each([
    '{.env.local,src/*.ts}', '{src/*.ts,.env.local}', '{src/*.ts,{docs/*.md,.env.production}}', 'src/{a,.env}', '**/{x,y,.env*}', '{*.ts,.env}',
    '{src/{a,{b,.env.local}},docs}',
  ])('a Glob of %s', (pattern) => {
    expect(reasonOf(globs(s, pattern, undefined, who))).toBe(ENV);
    expect(reasonOf(globs(s, pattern, 'contracts', who))).toBe(ENV);
  });

  test.each(['{.env.local,src/*.ts}', 'src/{a,.env.production}', '{src/*.ts,{docs/*.md,.env}}'])('a Grep with the glob %s', (glob) => {
    expect(reasonOf(greps(s, 'contracts', who, glob))).toBe(ENV);
    expect(reasonOf(greps(s, undefined, who, glob))).toBe(ENV);
  });

  test('a brace that makes too many alternatives to check is refused too', () => {
    expect(reasonOf(globs(s, '{a,b}'.repeat(12), undefined, who))).toBe(ENV);
  });
});

describe('R78 leaves braces that hold no env file alone', () => {
  const free = asMain();
  test.each(['{src/*.ts,docs/*.md}', '**/*.{ts,tsx}', '{.env.example,src/*.ts}', 'src/{a,{b,c}}/*.ts', '{.envrc,notes.md}', '{a}', '{src,tests}/**/*.ts'])('a Glob of %s', (pattern) => {
    isAllowed(globs(s, pattern, undefined, free));
  });
  test.each(['{src/*.ts,docs/*.md}', '*.{ts,tsx}', '{.env.example,src/*.ts}'])('a Grep with the glob %s', (glob) => {
    isAllowed(greps(s, 'src', free, glob));
  });
});
