// The plan's file paths are from the app folder. With `seam-app` as the app folder, a plan that lists
// `src/helper.ts` allows an import of `seam-app/src/helper.ts`, and not of a `src/helper.ts` at the repo root.
import { describe, expect, test } from 'vitest';
import type { Plan } from '../../src/formats/plan.ts';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { FILLED, HEADER_END, edit, file, lockFor, plan, seam } from '../helpers/lockcheck.ts';

const APP_FILE = 'seam-app/src/pricing/total.ts';
const ROOT_TWIN = 'src/pricing/total.ts';
const refused = (spec: string): string[] => [`import of '${spec}' isn't in the plan`];

/** The practice plan with its app in `seam-app`, and a planned `src/helper.ts` (and what `src/pricing/total.ts` itself names, if given). */
function inSeamApp(named: string[] = []): Plan {
  const helper = { ...file, path: 'src/helper.ts' };
  const own = { ...file, imports: named };
  return {
    ...plan,
    appRoot: 'seam-app',
    seams: plan.seams.map((s) => (s.id === seam ? { ...s, files: [own, helper] } : s)),
  };
}

/** The problems with `at` gaining an import of `spec`, against a lock of `at` as it is without one. */
function importing(at: string, spec: string, using: Plan): string[] {
  const proposed = edit(HEADER_END, `${HEADER_END}import x from '${spec}';\n`);
  return checkAgainstLock(at, proposed, lockFor(at, FILLED), using);
}

describe('planned imports are resolved under the app folder only', () => {
  test('a file in the app may import the planned file that is in the app', () => {
    expect(importing(APP_FILE, '../helper', inSeamApp())).toEqual([]);
    expect(importing(APP_FILE, '../helper.ts', inSeamApp())).toEqual([]);
  });

  test('a file in the app may not import a root-level file that has the same path as a planned one', () => {
    expect(importing(APP_FILE, '../../../src/helper', inSeamApp())).toEqual(refused('../../../src/helper'));
    expect(importing(APP_FILE, '../../../src/helper.ts', inSeamApp())).toEqual(refused('../../../src/helper.ts'));
  });

  test('a file outside the app that happens to share a planned path gets no import from the plan', () => {
    expect(importing(ROOT_TWIN, '../helper', inSeamApp())).toEqual(refused('../helper'));
    expect(importing(ROOT_TWIN, '../../seam-app/src/helper', inSeamApp())).toEqual([]); // the planned one, reached by its real path
  });

  test('what a planned file names for itself counts for that file and not for its root-level twin', () => {
    const using = inSeamApp(['src/util.ts']);
    expect(importing(APP_FILE, '../util', using)).toEqual([]);
    expect(importing(ROOT_TWIN, '../util', using)).toEqual(refused('../util'));
    expect(importing(APP_FILE, '../../../src/util', using)).toEqual(refused('../../../src/util'));
  });

  test('named imports (packages) are the planned file\'s own: the root-level twin does not get them', () => {
    const using = inSeamApp(['lodash']);
    expect(importing(APP_FILE, 'lodash', using)).toEqual([]);
    expect(importing(ROOT_TWIN, 'lodash', using)).toEqual(refused('lodash'));
  });

  test('with the app at the repo root (".") nothing changes: planned paths are from the repo root', () => {
    const atRoot: Plan = { ...inSeamApp(), appRoot: '.' };
    expect(importing(ROOT_TWIN, '../helper', atRoot)).toEqual([]);
    expect(importing(ROOT_TWIN, '../../seam-app/src/helper', atRoot)).toEqual(refused('../../seam-app/src/helper'));
  });
});
