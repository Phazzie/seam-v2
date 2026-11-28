// R59: the tests run (npm test, npm run test, npx vitest run) only in the build and flip phases. Before that they
// are being written, and a test run can write files, which is how code gets in through a test. In the other phases
// they run through the seam scripts. `npm run typecheck`, the version checks and the read-only commands run in any phase.
import { beforeAll, describe, expect, test } from 'vitest';
import { PHASES } from '../../src/types.ts';
import type { Phase } from '../../src/types.ts';
import { commandScene, expectRuns, whyNot } from '../helpers/command.ts';
import type { Scene } from '../helpers/decide.ts';

let s: Scene;
beforeAll(async () => {
  s = await commandScene();
});

const TEST_PHASES: Phase[] = ['build', 'flip'];
const OTHER_PHASES = PHASES.filter((phase) => !TEST_PHASES.includes(phase));
const TOOLS = ['Bash', 'PowerShell'] as const;
const RUNS_TESTS = ['npm test', 'npm run test', 'NPM TEST', 'npx vitest run', 'npx vitest run test/unit/total.test.ts', 'npx vitest run test/a.test.ts test/b.test.ts'];
const ANY_PHASE = [
  'npm run typecheck', 'npm --version', 'node --version', 'git status', 'git log --oneline -5', 'git diff', 'git show HEAD', 'git branch', 'seam report', 'seam status',
  'seam request freeze', 'seam help',
];

describe('R59: the tests run in the build and flip phases', () => {
  describe.each(TEST_PHASES)('%s', (phase) => {
    describe.each(TOOLS)('%s', (tool) => {
      test.each(RUNS_TESTS)('%s', (command) => expectRuns(s, command, { tool, phase }));
    });
  });
});

describe('R59: in every other phase they are refused, and the reason says where tests run', () => {
  test('the phases other than build and flip are the eight the project goes through before and after', () => {
    expect(OTHER_PHASES).toEqual(['setup', 'survey', 'plan1', 'probe', 'plan2', 'skeleton', 'tests', 'cutover']);
  });
  describe.each(OTHER_PHASES)('%s', (phase) => {
    describe.each(TOOLS)('%s', (tool) => {
      test.each(RUNS_TESTS)('%s', (command) => {
        expect(whyNot(s, command, { tool, phase })).toBe('tests run through the seam scripts in this phase');
      });
    });
  });
});

describe('R59: everything else on the list runs in every phase', () => {
  describe.each(PHASES)('%s', (phase) => {
    test.each(ANY_PHASE)('%s', (command) => {
      for (const tool of TOOLS) expectRuns(s, command, { tool, phase });
    });
  });
});

describe('R59: the form is still checked, in any phase', () => {
  test('a test run with something added is refused for that, not as a phase question, in the build phase', () => {
    expect(whyNot(s, 'npm test --silent')).toMatch(/take nothing added/);
    expect(whyNot(s, 'npx vitest run --config evil.js')).toMatch(/takes test file paths only|it takes test file paths only/);
  });
  test('and before the build it is the phase that is said', () => {
    expect(whyNot(s, 'npm test --silent', { phase: 'plan1' })).toMatch(/take nothing added/);
    expect(whyNot(s, 'npx vitest run --config evil.js', { phase: 'plan1' })).toBe('tests run through the seam scripts in this phase');
  });
  test('only the main AI at all: a builder in the build phase is refused as before', () => {
    expect(whyNot(s, 'npm test', { who: { agent_id: 'b-1', agent_type: 'seam-v2:builder' }, phase: 'build' })).toBe('only the main AI may run commands');
  });
});
