// The plain sentences decideWrite refuses with. Each says why, in words the AI can act on. None of them uses
// the phrase the guard's own failures carry ("blocked to be safe", Ruling R16): these are rules being applied.
import type { PathClass } from '../lib/paths.ts';
import type { Phase, Role } from '../types.ts';

/** Places no role may write, by kind of path (a checker's verdict file is the one exception). */
export const PROTECTED: Partial<Record<PathClass, string>> = {
  'seam-records': 'the seam records (.seam) are written only by the seam scripts',
  'claude-config': 'Claude settings and instructions (.claude/, CLAUDE.md, AGENTS.md) are protected; only the owner changes them',
  'user-claude-config': "the owner's Claude settings and plugins are protected; only the owner changes them",
  plugin: "the plugin's own files are protected",
  'data-dir': "the plugin's data folder is protected; it holds the guard's own records",
  legacy: 'the old app is protected; it is read, never written',
  fixtures: 'fixtures are protected; only the probe script writes them',
  'config-file': "config files are frozen; they're written by the seam scripts",
  generated: 'generated files are protected; the tool that makes them writes them',
};

/** The roles that write no files at all, and what to do instead. */
export const READS_ONLY: Partial<Record<Role, string>> = {
  describer: 'a describer only reads; it hands its account back to the main AI',
  surveyor: 'a surveyor only reads; it hands its draft back to the main AI to save',
  readonly: 'this agent is read-only, so it cannot write files',
  checker: 'a checker writes only its verdict file (.seam/verdicts/<name>.json)',
  design: "the design pass can't write yet (styling edits arrive in a later stage)",
};

export const NO_FILE = "this write doesn't name a file the guard can read";
export const ONLY_BUILDERS = 'only builders write app code; the main AI plans and coordinates';
export const IN_BUILD_OUTPUT = "node_modules and build output can't be written to (logic could hide there)";
export const NO_LOCK = 'there is no lock yet, so the build has not started and no code can be written';

export const notInPlan = (file: string): string => `${file} isn't in the plan: code that is not in the plan can't be written anywhere`;
export const notYourTurn = (file: string): string => `it isn't this builder's turn for ${file}`;
export const buildOnly = (phase: Phase): string => `builders write only during the build phase, and this project is in ${phase}`;
export const planFrozen = (phase: Phase): string =>
  `the plan is frozen once the owner approves it; it can change only in the planning phases (setup, survey, plan1, plan2), and this project is in ${phase}`;
export const contractsFrozen = (phase: Phase): string =>
  `contracts are written only in the second planning phase (plan2) and are frozen after it, and this project is in ${phase}`;
export const testsFrozen = (phase: Phase): string =>
  `tests are written only in the tests phase and are frozen after the owner approves them, and this project is in ${phase}`;

/** What to do about a problem, where there is something to do. */
const HINTS: readonly (readonly [RegExp, string])[] = [
  [/silent catch$/, ' (throw the error or use it)'],
  [/is used by a locked signature/, ' (if the plan needs this, ask the owner for a plan change)'],
];

const withHint = (problem: string): string => problem + (HINTS.find(([pattern]) => pattern.test(problem))?.[1] ?? '');
/** A code-rule problem is a phrase that reads after the file ("uses the any type"): make it a sentence part. */
const aboutFile = (problem: string): string => (problem.startsWith('the file') ? problem : `the file ${problem}`);

/**
 * The reason for refusing a write to `file`: everything wrong with it, each problem once (the lock check and
 * the code rules both report a file that does not parse), with the hint for the ones that have one.
 */
export function refusal(file: string, lockProblems: readonly string[], ruleProblems: readonly string[]): string {
  const all = new Set([...lockProblems, ...ruleProblems.map(aboutFile)]);
  return `${file} wasn't written: ${[...all].map(withHint).join('; ')}`;
}
