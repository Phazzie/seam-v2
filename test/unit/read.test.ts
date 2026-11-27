// decideRead, the builder's allowlist and the other roles. A builder reads its own file, the contracts, the
// files its file imports, the type files of the planned packages and, for a mock or an adapter, its seam's
// fixtures; never tests. A describer reads only `.seam/review`. Everyone else reads freely (R55 is in
// read-env.test.ts). Each case asks the decision directly.
import { beforeAll, describe, expect, test } from 'vitest';
import { asBuilder, asChecker, asMain } from '../helpers/app.ts';
import { TOTAL } from '../helpers/code.ts';
import { BUILDER } from '../helpers/decide.ts';
import type { Scene } from '../helpers/decide.ts';
import { API, asks, builder, FORMAT, isAllowed, MOCK, MONEY, reads, readScene, reasonOf, SHARED_INDEX, turnOn } from '../helpers/read.ts';

const TESTS = "builders don't read tests; you'll be told which promise failed";
const NOT_READABLE = /isn't something a builder reads/;

let s: Scene;
beforeAll(async () => {
  s = await readScene();
});

describe('a builder reads its own file', () => {
  test('its turn file is allowed', () => isAllowed(reads(s, TOTAL, builder())));
  test('a path spelled another way is the same file', () => isAllowed(reads(s, 'src/greeting/../pricing/total.ts', builder())));
  test.runIf(process.platform === 'win32')('and so is the same path in other letter case', () => isAllowed(reads(s, 'SRC\\Pricing\\TOTAL.ts', builder())));
  test('another planned file is not its own', () => expect(reasonOf(reads(s, 'src/greeting/Greeting.tsx', builder()))).toMatch(NOT_READABLE));
  test('a file that is not in the plan is not readable either', () => expect(reasonOf(reads(s, 'notes.md', builder()))).toMatch(NOT_READABLE));
});

describe('a builder never reads tests (the message says so, however the test is named)', () => {
  test.each(['tests/total.test.ts', 'tests/helpers/fake.ts', 'src/pricing/total.test.ts', 'src/pricing/total.spec.tsx'])('%s', (rel) => {
    expect(reasonOf(reads(s, rel, builder()))).toBe(TESTS);
  });
  test('a test spelled with .. is the same test', () => expect(reasonOf(reads(s, 'src/pricing/../../tests/total.test.ts', builder()))).toBe(TESTS));
  test.runIf(process.platform === 'win32')('and so is one in other letter case', () => expect(reasonOf(reads(s, 'TESTS/Helpers/Fake.ts', builder()))).toBe(TESTS));
  test('the test is refused even when the file it belongs to is the builder\'s own', () => {
    expect(reasonOf(reads(s, 'tests/total.test.ts', builder(), turnOn(s, TOTAL)))).toBe(TESTS);
  });
});

describe('a builder reads the contracts', () => {
  test.each(['contracts/order.ts', 'contracts/sub/line.ts'])('%s is allowed', (rel) => isAllowed(reads(s, rel, builder())));
  test('a contracts file that does not exist yet is allowed too (the read itself will fail)', () => isAllowed(reads(s, 'contracts/new.ts', builder())));
});

describe('a builder reads the files its file imports', () => {
  const adapter = () => turnOn(s, API);
  test('a file named by a relative import without an extension', () => isAllowed(reads(s, MONEY, builder(), adapter())));
  test('a file named with its extension', () => isAllowed(reads(s, FORMAT, builder(), adapter())));
  test('a folder named by an import stands for its index file', () => isAllowed(reads(s, SHARED_INDEX, builder(), adapter())));
  test('but not for the other files in that folder', () => expect(reasonOf(reads(s, 'src/shared/other.ts', builder(), adapter()))).toMatch(NOT_READABLE));
  test('a planned file it does not import is not allowed', () => expect(reasonOf(reads(s, MOCK, builder(), adapter()))).toMatch(NOT_READABLE));
  test('imports are the file\'s own: the total imports nothing, so the money file is not open to it', () => {
    expect(reasonOf(reads(s, MONEY, builder()))).toMatch(NOT_READABLE);
  });
  test('a test it imports is still a test', () => {
    expect(reasonOf(reads(s, 'tests/total.test.ts', builder(), adapter()))).toBe(TESTS);
  });
});

describe('a builder of a mock or an adapter reads its own seam\'s fixtures', () => {
  test.each([API, MOCK])('%s reads fixtures/orders.ts, a name that starts with its seam, and a folder named for it', (file) => {
    for (const rel of ['fixtures/orders.ts', 'fixtures/orders-list.ts', 'fixtures/orders/page.ts', 'probes/fixtures/orders.ts']) {
      isAllowed(reads(s, rel, builder(), turnOn(s, file)));
    }
  });
  test.each([API, MOCK])('%s does not read another seam\'s fixtures', (file) => {
    for (const rel of ['fixtures/pricing.ts', 'probes/fixtures/pricing.ts', 'fixtures/ordersheet.ts']) {
      expect(reasonOf(reads(s, rel, builder(), turnOn(s, file))), rel).toMatch(NOT_READABLE);
    }
  });
  test('a plain code file of the same seam reads no fixtures (only mocks and adapters do)', () => {
    expect(reasonOf(reads(s, 'fixtures/orders.ts', builder(), turnOn(s, FORMAT)))).toMatch(NOT_READABLE);
  });
  test('a screen of another seam reads none', () => {
    expect(reasonOf(reads(s, 'fixtures/pricing.ts', builder(), turnOn(s, 'src/greeting/Greeting.tsx')))).toMatch(NOT_READABLE);
  });
});

describe('a builder reads the type files of the planned packages, and nothing else in node_modules', () => {
  test.each([
    'node_modules/react/index.d.ts', 'node_modules/react/jsx/runtime.d.ts', 'node_modules/@types/react/index.d.ts',
    'node_modules/@scope/kit/index.d.ts', 'node_modules/@types/scope__kit/index.d.ts',
  ])('%s is allowed', (rel) => isAllowed(reads(s, rel, builder())));
  test.each(['node_modules/react/index.js', 'node_modules/lodash/index.d.ts', 'node_modules/@types/lodash/index.d.ts', 'node_modules/.package-lock.json'])('%s is not', (rel) => {
    expect(reasonOf(reads(s, rel, builder()))).toMatch(NOT_READABLE);
  });
});

describe('what a builder reads is about the builder whose turn it is', () => {
  test('another agent id has nothing to read, not even the file of the turn', () => {
    expect(reasonOf(reads(s, TOTAL, asBuilder('builder-2')))).toMatch(/isn't this builder's turn/);
  });
  test('a builder with no agent id has nothing to read', () => {
    expect(reasonOf(reads(s, TOTAL, { agent_type: 'seam-v2:builder' }))).toMatch(/isn't this builder's turn/);
  });
  test('with no turn recorded nobody has', () => {
    expect(reasonOf(reads(s, TOTAL, builder(), turnOn(s, null)))).toMatch(/isn't this builder's turn/);
  });
  test('the turn is for the builder named in it', () => {
    expect(BUILDER).toBe('builder-1');
    isAllowed(reads(s, TOTAL, asBuilder(BUILDER)));
  });
  test('a Read that names no file reads nothing', () => {
    expect(reasonOf(asks(s, 'Read', {}, builder()))).toMatch(/doesn't name a file/);
  });
});

describe('everyone but a builder and a describer reads freely', () => {
  test.each([['main', asMain()], ['checker', asChecker()], ['surveyor', { agent_id: 's-1', agent_type: 'seam-v2:surveyor' }], ['design', { agent_id: 'd-1', agent_type: 'seam-v2:design' }], ['a built-in agent', { agent_id: 'g-1', agent_type: 'general-purpose' }]])(
    '%s reads tests, plan, records, other seams and fixtures',
    (_name, who) => {
      for (const rel of ['tests/total.test.ts', 'plan/plan.json', '.seam/state.json', 'src/greeting/Greeting.tsx', 'fixtures/pricing.ts', 'node_modules/react/index.js', 'notes.md']) {
        isAllowed(reads(s, rel, who));
      }
    },
  );
  test('a path outside the project is the main AI\'s to read too', () => isAllowed(reads(s, '../elsewhere/file.txt', asMain())));
});

describe('a describer reads only what is under .seam/review', () => {
  const describer = { agent_id: 'describer-1', agent_type: 'seam-v2:describer' };
  test.each(['.seam/review/total.ts', '.seam/review/sub/more.ts'])('%s is allowed', (rel) => isAllowed(reads(s, rel, describer)));
  test.each([TOTAL, 'tests/total.test.ts', 'contracts/order.ts', '.seam/state.json', '.seam/review/../state.json', 'plan/plan.json', 'notes.md'])('%s is refused', (rel) => {
    expect(reasonOf(reads(s, rel, describer))).toMatch(/a describer reads only/);
  });
});
