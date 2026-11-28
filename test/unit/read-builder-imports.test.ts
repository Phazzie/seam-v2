// R78 (Codex on PR #23): a builder may read the files its own planned file imports. The plan writes an import as a path from the app
// folder too (`imports: ["src/util.ts"]`, which the lock check resolves under the app folder and allows), but the read check only
// understood `./x` and `../x`, so the builder was refused a file the plan gave it. Those entries are resolved under the app folder now.
import { beforeAll, describe, test } from 'vitest';
import { loadPlan } from '../../src/formats/plan.ts';
import type { FilePlan } from '../../src/formats/plan.ts';
import type { Ctx } from '../../src/types.ts';
import { FIXTURE } from '../helpers/code.ts';
import type { Scene } from '../helpers/decide.ts';
import { scene } from '../helpers/decide.ts';
import { builder, isAllowed, reads, reasonOf, turnOn } from '../helpers/read.ts';

const code = 'export const x = 1;\n';
const entry = (path: string, imports: string[] = []): FilePlan => ({
  path, kind: 'code', purpose: 'Do one small job.', inputs: 'nothing', outputs: 'nothing', imports,
  exports: [{ name: 'run', signature: 'run(): void' }],
  steps: ['Take the input', 'Work on the input', 'Hand back the result'], promises: [], estLines: 20,
});

/** A project whose plan has appRoot `appRoot`, a seam `orders` with the file `src/orders/api.ts` importing `imports`, and the files below on disk (paths from the repo root). */
async function planned(appRoot: string, imports: string[], packages: string[], files: string[]): Promise<{ s: Scene; ctx: Ctx; own: string }> {
  const base = loadPlan(FIXTURE);
  if (base === null) throw new Error('Test setup: the practice app has no plan.');
  const prefix = appRoot === '.' ? '' : `${appRoot}/`;
  const plan = { ...base, appRoot, packages, seams: [{ id: 'orders', name: 'Orders', services: [], files: [entry('src/orders/api.ts', imports), entry('src/util.ts'), entry('src/shared/money.ts')] }] };
  const disk: Record<string, string> = { 'plan/plan.json': JSON.stringify(plan), [`${prefix}src/orders/api.ts`]: code };
  for (const file of files) disk[file] = code;
  const s = await scene({ lock: false, files: disk });
  const own = `${prefix}src/orders/api.ts`;
  return { s, ctx: turnOn(s, own), own };
}

describe('a planned import written as a path from the app folder', () => {
  let a: Awaited<ReturnType<typeof planned>>;
  beforeAll(async () => {
    a = await planned('.', ['src/util.ts', 'src/shared', 'src/orders/helper', 'lodash'], ['lodash'], [
      'src/util.ts', 'src/shared/index.ts', 'src/shared/money.ts', 'src/orders/helper.ts', 'src/other.ts', 'lodash.ts', 'src/orders/lodash.ts',
    ]);
  });

  test.each(['src/util.ts', 'src/shared/index.ts', 'src/orders/helper.ts'])('the builder may read %s (a file, a folder and a file without its extension)', (rel) => {
    isAllowed(reads(a.s, rel, builder(), a.ctx));
  });

  test('a file the plan does not name stays out of reach, and so does one in the named folder that is not its index', () => {
    reasonOf(reads(a.s, 'src/other.ts', builder(), a.ctx));
    reasonOf(reads(a.s, 'src/shared/money.ts', builder(), a.ctx));
  });

  test('a package the plan lists is not a file: a file named like it at the app folder is not readable for that', () => {
    reasonOf(reads(a.s, 'lodash.ts', builder(), a.ctx));
  });
});

describe('with the app in its own folder', () => {
  test('an import is a path from the app folder, so it reads the app\'s file and not one of the same name at the repo root', async () => {
    const a = await planned('seam-app', ['src/util.ts', './helper'], [], ['seam-app/src/util.ts', 'seam-app/src/orders/helper.ts', 'src/util.ts', 'seam-app/src/other.ts']);
    isAllowed(reads(a.s, 'seam-app/src/util.ts', builder(), a.ctx));
    isAllowed(reads(a.s, 'seam-app/src/orders/helper.ts', builder(), a.ctx)); // a relative import is still from the file's own folder
    reasonOf(reads(a.s, 'src/util.ts', builder(), a.ctx));
    reasonOf(reads(a.s, 'seam-app/src/other.ts', builder(), a.ctx));
  });
});

describe('entries that are not paths do not break the check or let anything in', () => {
  test.each([['node:fs'], ['@scope/kit'], ['react/jsx-runtime'], ['C:/Windows/win.ini'], ['../../outside.ts']])('an import of %s', async (spec) => {
    const a = await planned('.', [spec], ['react'], ['src/other.ts']);
    reasonOf(reads(a.s, 'src/other.ts', builder(), a.ctx));
    isAllowed(reads(a.s, a.own, builder(), a.ctx));
  });
});
