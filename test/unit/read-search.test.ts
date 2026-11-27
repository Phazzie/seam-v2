// decideRead for Glob and Grep: a builder's search must have a `path` inside what it may read, and a Glob
// pattern or Grep glob that reaches out of it (an absolute one, or one with `..`) is refused. A describer's
// search stays inside .seam/review the same way. Everyone else searches freely.
import { beforeAll, describe, expect, test } from 'vitest';
import { asMain } from '../helpers/app.ts';
import { TOTAL } from '../helpers/code.ts';
import type { Scene } from '../helpers/decide.ts';
import { API, asks, builder, globs, greps, isAllowed, MOCK, readScene, reasonOf, turnOn } from '../helpers/read.ts';

const TESTS = "builders don't read tests; you'll be told which promise failed";
const NEEDS_PATH = /a builder's search must give a path inside what it may read/;
const NOT_READABLE = /isn't something a builder reads/;
const ESCAPES = /reaches outside what a builder may read/;
const TYPES_ONLY = /only the type files/;

let s: Scene;
beforeAll(async () => {
  s = await readScene();
});
const abs = (rel: string): string => s.app.abs(rel);

describe('a builder\'s Glob or Grep must have a path', () => {
  test('a Glob with no path is refused', () => expect(reasonOf(globs(s, '*.ts', undefined, builder()))).toMatch(NEEDS_PATH));
  test('a Grep with no path is refused', () => expect(reasonOf(greps(s, undefined, builder()))).toMatch(NEEDS_PATH));
  test('an empty path is no path', () => expect(reasonOf(asks(s, 'Grep', { pattern: 'x', path: '' }, builder()))).toMatch(NEEDS_PATH));
  test('a Grep with a glob but no path is refused as well', () => expect(reasonOf(greps(s, undefined, builder(), '*.ts'))).toMatch(NEEDS_PATH));
  test('the project folder itself is not inside what it may read', () => {
    expect(reasonOf(globs(s, '**/*.ts', '.', builder()))).toMatch(NOT_READABLE);
    expect(reasonOf(greps(s, '.', builder()))).toMatch(NOT_READABLE);
  });
  test.each(['src', 'src/pricing', 'src/shared', 'plan', '.seam', 'fixtures', 'node_modules', 'probes/fixtures'])('%s is a folder with more than it may read', (rel) => {
    expect(reasonOf(globs(s, '*', rel, builder(), turnOn(s, API)))).toMatch(NOT_READABLE);
    expect(reasonOf(greps(s, rel, builder(), undefined, turnOn(s, API)))).toMatch(NOT_READABLE);
  });
});

describe('a builder\'s search inside what it may read', () => {
  test.each(['*.ts', '**/*.ts', '**/*', 'order*'])('a Glob of %s in the contracts', (pattern) => isAllowed(globs(s, pattern, 'contracts', builder())));
  test('a Glob or Grep in a folder inside the contracts', () => {
    isAllowed(globs(s, '*.ts', 'contracts/sub', builder()));
    isAllowed(greps(s, 'contracts/sub', builder()));
  });
  test('a Grep in the contracts, with a glob that stays inside them', () => {
    isAllowed(greps(s, 'contracts', builder()));
    isAllowed(greps(s, 'contracts', builder(), '*.ts'));
    isAllowed(greps(s, 'contracts', builder(), '**/*.{ts,tsx}'));
  });
  test('a Grep in its own file, and in a file it imports', () => {
    isAllowed(greps(s, TOTAL, builder()));
    isAllowed(greps(s, 'src/shared/money.ts', builder(), undefined, turnOn(s, API)));
  });
  test('a Grep in its own seam\'s fixtures, for a mock or an adapter', () => {
    isAllowed(greps(s, 'fixtures/orders', builder(), undefined, turnOn(s, MOCK)));
    isAllowed(globs(s, '*.ts', 'fixtures/orders', builder(), turnOn(s, API)));
    isAllowed(greps(s, 'fixtures/orders.ts', builder(), undefined, turnOn(s, API)));
  });
  test('but not for a file that is not a mock or an adapter', () => {
    expect(reasonOf(greps(s, 'fixtures/orders', builder(), undefined, turnOn(s, 'src/orders/format.ts')))).toMatch(NOT_READABLE);
  });
  test('and not in another seam\'s fixtures', () => {
    expect(reasonOf(greps(s, 'fixtures/pricing.ts', builder(), undefined, turnOn(s, API)))).toMatch(NOT_READABLE);
  });
  test('only when it is this builder\'s turn', () => {
    expect(reasonOf(globs(s, '*.ts', 'contracts', { agent_id: 'builder-2', agent_type: 'seam-v2:builder' }))).toMatch(/isn't this builder's turn/);
  });
});

describe('a builder never searches the tests', () => {
  test('Glob **/*.test.ts, with and without a path', () => {
    expect(reasonOf(globs(s, '**/*.test.ts', undefined, builder()))).toBe(TESTS);
    expect(reasonOf(globs(s, '**/*.test.ts', 'contracts', builder()))).toBe(TESTS);
    expect(reasonOf(globs(s, '**/*.spec.tsx', 'contracts', builder()))).toBe(TESTS);
    expect(reasonOf(globs(s, 'tests/**', 'contracts', builder()))).toBe(TESTS);
  });
  test('Grep in the tests folder, in a test file, with a test glob', () => {
    expect(reasonOf(greps(s, 'tests', builder()))).toBe(TESTS);
    expect(reasonOf(greps(s, 'tests/total.test.ts', builder()))).toBe(TESTS);
    expect(reasonOf(greps(s, 'src/pricing/total.test.ts', builder()))).toBe(TESTS);
    expect(reasonOf(greps(s, 'contracts', builder(), '*.test.ts'))).toBe(TESTS);
    expect(reasonOf(greps(s, undefined, builder(), '**/*.spec.ts'))).toBe(TESTS);
  });
  test('Glob in the tests folder', () => expect(reasonOf(globs(s, '*', 'tests', builder()))).toBe(TESTS));
});

describe('a pattern that reaches out of the allowed folders is refused', () => {
  test('an absolute Glob pattern into the tests, or into code, from an allowed path', () => {
    expect(reasonOf(globs(s, `${abs('tests').replace(/\\/g, '/')}/**/*.ts`, 'contracts', builder()))).toBe(TESTS);
    expect(reasonOf(globs(s, `${abs('src').replace(/\\/g, '/')}/**/*.ts`, 'contracts', builder()))).toMatch(ESCAPES);
    expect(reasonOf(globs(s, abs('plan/plan.json'), 'contracts', builder()))).toMatch(ESCAPES);
  });
  test('an absolute Glob pattern spelled with backslashes', () => {
    expect(reasonOf(globs(s, `${abs('src')}\\**\\*.ts`, 'contracts', builder()))).toMatch(ESCAPES);
  });
  test('a Glob pattern with .. that goes up out of the contracts', () => {
    expect(reasonOf(globs(s, '../tests/**', 'contracts', builder()))).toBe(TESTS);
    expect(reasonOf(globs(s, '../src/**/*.ts', 'contracts', builder()))).toMatch(ESCAPES);
    expect(reasonOf(globs(s, '../../*', 'contracts/sub', builder()))).toMatch(ESCAPES);
    expect(reasonOf(globs(s, '..\\src\\**', 'contracts', builder()))).toMatch(ESCAPES);
    expect(reasonOf(globs(s, '**/../../src/*.ts', 'contracts', builder()))).toMatch(ESCAPES);
  });
  test('a Grep glob does the same', () => {
    expect(reasonOf(greps(s, 'contracts', builder(), `${abs('src').replace(/\\/g, '/')}/**`))).toMatch(ESCAPES);
    expect(reasonOf(greps(s, 'contracts', builder(), '../tests/*'))).toBe(TESTS);
    expect(reasonOf(greps(s, TOTAL, builder(), '../**'))).toMatch(ESCAPES);
  });
  test('an absolute or .. pattern that stays inside what is allowed is fine', () => {
    isAllowed(globs(s, `${abs('contracts').replace(/\\/g, '/')}/**/*.ts`, 'contracts', builder()));
    isAllowed(globs(s, '../*.ts', 'contracts/sub', builder()));
    isAllowed(globs(s, '../sub/*.ts', 'contracts/sub', builder()));
  });
  test('a ~ pattern is an absolute one', () => expect(reasonOf(globs(s, '~/**', 'contracts', builder()))).toMatch(ESCAPES));
});

describe('node_modules: the type files of the planned packages, and a search must say so', () => {
  test('a Glob or Grep of .d.ts files in a planned package', () => {
    isAllowed(globs(s, '**/*.d.ts', 'node_modules/react', builder()));
    isAllowed(globs(s, '*.d.ts', 'node_modules/@types/react', builder()));
    isAllowed(greps(s, 'node_modules/@scope/kit', builder(), '*.d.ts'));
    isAllowed(greps(s, 'node_modules/@types/scope__kit', builder(), '**/*.d.ts'));
    isAllowed(greps(s, 'node_modules/react/index.d.ts', builder()));
  });
  test('without the .d.ts it would read the code', () => {
    expect(reasonOf(globs(s, '**/*', 'node_modules/react', builder()))).toMatch(TYPES_ONLY);
    expect(reasonOf(globs(s, '**/*.js', 'node_modules/react', builder()))).toMatch(TYPES_ONLY);
    expect(reasonOf(greps(s, 'node_modules/react', builder()))).toMatch(TYPES_ONLY);
    expect(reasonOf(greps(s, 'node_modules/react', builder(), '*.{js,ts}'))).toMatch(TYPES_ONLY);
  });
  test('an unplanned package, or all of node_modules, is not allowed at all', () => {
    expect(reasonOf(globs(s, '**/*.d.ts', 'node_modules/lodash', builder()))).toMatch(NOT_READABLE);
    expect(reasonOf(globs(s, '**/*.d.ts', 'node_modules', builder()))).toMatch(NOT_READABLE);
    expect(reasonOf(globs(s, '**/*.d.ts', 'node_modules/@types', builder()))).toMatch(NOT_READABLE);
  });
});

describe('a describer searches only inside .seam/review', () => {
  const describer = { agent_id: 'describer-1', agent_type: 'seam-v2:describer' };
  const ONLY = /a describer reads only/;
  test('Glob and Grep in the review folder', () => {
    isAllowed(globs(s, '*.ts', '.seam/review', describer));
    isAllowed(globs(s, '**/*', '.seam/review', describer));
    isAllowed(greps(s, '.seam/review', describer));
    isAllowed(greps(s, '.seam/review/sub', describer, '*.ts'));
  });
  test('with no path it has nowhere to look', () => {
    expect(reasonOf(globs(s, '*.ts', undefined, describer))).toMatch(/a describer's search must give a path inside \.seam\/review/);
    expect(reasonOf(greps(s, undefined, describer))).toMatch(/a describer's search must give a path inside \.seam\/review/);
  });
  test.each(['.', '.seam', 'src', 'tests', 'contracts'])('%s is outside it', (rel) => {
    expect(reasonOf(globs(s, '*', rel, describer))).toMatch(ONLY);
    expect(reasonOf(greps(s, rel, describer))).toMatch(ONLY);
  });
  test('a pattern that leaves the review folder', () => {
    expect(reasonOf(globs(s, '../state.json', '.seam/review', describer))).toMatch(ONLY);
    expect(reasonOf(globs(s, `${abs('tests').replace(/\\/g, '/')}/**`, '.seam/review', describer))).toMatch(ONLY);
    expect(reasonOf(greps(s, '.seam/review', describer, '../../tests/*'))).toMatch(ONLY);
  });
});

describe('everyone else searches freely (a search with no path, tests, patterns that climb)', () => {
  test('the main AI', () => {
    isAllowed(globs(s, '**/*.test.ts', undefined, asMain()));
    isAllowed(greps(s, 'tests', asMain()));
    isAllowed(greps(s, undefined, asMain(), '../**'));
    isAllowed(globs(s, `${abs('tests').replace(/\\/g, '/')}/**`, 'contracts', asMain()));
  });
});

describe('a path written from the session folder is read from it', () => {
  test('a relative path, from the project folder and from a folder inside it', () => {
    isAllowed(asks(s, 'Read', { file_path: TOTAL }, builder()));
    isAllowed(asks(s, 'Grep', { pattern: 'x', path: 'contracts' }, builder()));
    expect(reasonOf(asks(s, 'Grep', { pattern: 'x', path: 'tests' }, builder()))).toBe(TESTS);
    isAllowed(asks(s, 'Read', { file_path: 'pricing/total.ts' }, builder(), s.ctx, s.app.abs('src')));
    expect(reasonOf(asks(s, 'Read', { file_path: '../tests/total.test.ts' }, builder(), s.ctx, s.app.abs('src')))).toBe(TESTS);
  });
  test('a pattern that climbs is judged from the path it searches, not from the session folder', () => {
    isAllowed(asks(s, 'Glob', { pattern: '../*.ts', path: 'contracts/sub' }, builder()));
    expect(reasonOf(asks(s, 'Glob', { pattern: '../*.ts', path: 'contracts' }, builder()))).toMatch(ESCAPES);
  });
});
