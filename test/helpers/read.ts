// Test helper: ask `decideRead` directly (in this process) about an app whose plan has more in it than the
// practice plan: an adapter that imports two files and a folder, a mock, a plain code file, and a shared
// file, in three seams. Nothing is locked or snapshotted; a read decision needs only the plan and the turn.
import { expect } from 'vitest';
import { loadPlan } from '../../src/formats/plan.ts';
import type { FilePlan } from '../../src/formats/plan.ts';
import { decideRead } from '../../src/guard/read.ts';
import type { Ctx, Decision } from '../../src/types.ts';
import { asBuilder } from './app.ts';
import type { Who } from './app.ts';
import { FIXTURE, TOTAL } from './code.ts';
import { pre } from './calls.ts';
import { asInput, BUILDER, inPhase, scene } from './decide.ts';
import type { Scene } from './decide.ts';

export const API = 'src/orders/api.ts';
export const MOCK = 'src/orders/mock.ts';
export const FORMAT = 'src/orders/format.ts';
export const MONEY = 'src/shared/money.ts';
export const SHARED_INDEX = 'src/shared/index.ts';

const entry = (path: string, kind: FilePlan['kind'], imports: string[] = []): FilePlan => ({
  path, kind, purpose: 'Do one small job.', inputs: 'nothing', outputs: 'nothing', imports,
  exports: [{ name: 'run', signature: 'run(): void' }],
  steps: ['Take the input', 'Work on the input', 'Hand back the result'], promises: [], estLines: 20,
});

function planText(): string {
  const base = loadPlan(FIXTURE);
  if (base === null) throw new Error('Test setup: the practice app has no plan.');
  const seam = (id: string, files: FilePlan[]) => ({ id, name: id, services: [], files });
  return JSON.stringify({
    ...base,
    seams: [
      ...base.seams,
      seam('orders', [entry(API, 'adapter', ['../shared/money', './format.ts', '../shared']), entry(MOCK, 'mock'), entry(FORMAT, 'code')]),
      seam('shared', [entry(MONEY, 'code'), entry(SHARED_INDEX, 'code'), entry('src/shared/other.ts', 'code')]),
    ],
    packages: ['react', '@scope/kit'],
  });
}

const code = 'export const x = 1;\n';
/** What is on disk besides the plan: tests, contracts, fixtures, packages, secrets, a describer's copy. */
const FILES: Record<string, string> = {
  'plan/plan.json': planText(),
  [TOTAL]: code, 'src/greeting/Greeting.tsx': code, [API]: code, [MOCK]: code, [FORMAT]: code, [MONEY]: code, [SHARED_INDEX]: code, 'src/shared/other.ts': code,
  'tests/total.test.ts': code, 'tests/helpers/fake.ts': code, 'src/pricing/total.test.ts': code, 'src/pricing/total.spec.tsx': code,
  'contracts/order.ts': code, 'contracts/sub/line.ts': code,
  'fixtures/orders.ts': code, 'fixtures/orders-list.ts': code, 'fixtures/orders/page.ts': code, 'fixtures/pricing.ts': code, 'fixtures/ordersheet.ts': code,
  'probes/fixtures/orders.ts': code, 'probes/fixtures/pricing.ts': code,
  'node_modules/react/index.d.ts': code, 'node_modules/react/index.js': code, 'node_modules/react/jsx/runtime.d.ts': code,
  'node_modules/@types/react/index.d.ts': code, 'node_modules/@scope/kit/index.d.ts': code, 'node_modules/@types/scope__kit/index.d.ts': code,
  'node_modules/lodash/index.d.ts': code, 'node_modules/@types/lodash/index.d.ts': code,
  '.env': 'KEY=secret\n', '.env.local': 'KEY=secret\n', '.env.example': 'KEY=\n', 'src/.env.production': 'KEY=secret\n', '.envrc': 'x\n', 'src/config/env.ts': code,
  '.seam/review/total.ts': code, '.seam/review/sub/more.ts': code, 'notes.md': 'x\n',
};

/** The practice app with the richer plan and files, the turn on `TOTAL`, and no lock. */
export const readScene = (): Promise<Scene> => scene({ lock: false, files: FILES });

/** The same project with the turn on another planned file (still the same builder). */
export const turnOn = (s: Scene, file: string | null): Ctx => inPhase(s, 'build', { file });

export const builder = (): Who => asBuilder(BUILDER);

/** What the guard says about `tool` with `toolInput`, called by `who`, from the app's folder. */
export const asks = (s: Scene, tool: string, toolInput: Record<string, unknown>, who: Who, ctx: Ctx = s.ctx, cwd?: string): Decision =>
  decideRead({ ...asInput(pre(tool, toolInput, who), s.app), ...(cwd === undefined ? {} : { cwd }) }, ctx);

/** A Read of `rel` (from the app's folder). */
export const reads = (s: Scene, rel: string, who: Who, ctx: Ctx = s.ctx): Decision => asks(s, 'Read', { file_path: s.app.abs(rel) }, who, ctx);

/** A Glob of `pattern`, in `rel` (a folder from the app's folder) or with no `path` at all. */
export const globs = (s: Scene, pattern: string, rel: string | undefined, who: Who, ctx: Ctx = s.ctx): Decision =>
  asks(s, 'Glob', { pattern, ...(rel === undefined ? {} : { path: s.app.abs(rel) }) }, who, ctx);

/** A Grep for `needle`, in `rel` or with no `path`, narrowed to `glob` if given. */
export const greps = (s: Scene, rel: string | undefined, who: Who, glob?: string, ctx: Ctx = s.ctx): Decision =>
  asks(s, 'Grep', { pattern: 'needle', ...(rel === undefined ? {} : { path: s.app.abs(rel) }), ...(glob === undefined ? {} : { glob }) }, who, ctx);

export function isAllowed(d: Decision): void {
  expect(d, d.kind === 'deny' ? `the guard refused: ${d.reason}` : '').toEqual({ kind: 'allow' });
}

/** The reason of a refusal; fails the test when the call was allowed. */
export function reasonOf(d: Decision): string {
  expect(d.kind, 'the guard allowed it').toBe('deny');
  return d.kind === 'deny' ? d.reason : '';
}
