// decideWrite when the app lives in a folder of the repo (the plan's appRoot is "app"): the lock is keyed
// from the repo root ("app/src/..."), while the code rules (the src/config/ exemption for process.env) are
// from the app folder ("src/..."). The two must not be mixed up.
import { resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import type { FilePlan } from '../../src/formats/plan.ts';
import type { Ctx } from '../../src/types.ts';
import { skeleton } from '../helpers/code.ts';
import { isAllowed, reasonOf, scene, theBuilder, writes } from '../helpers/decide.ts';
import type { Scene } from '../helpers/decide.ts';
import { lockFor } from '../helpers/lockcheck.ts';

const planned = (path: string): FilePlan => ({
  path, kind: 'code', purpose: 'Read the home folder.', inputs: 'nothing', outputs: 'the home folder as text',
  imports: [], exports: [{ name: 'home', signature: 'home(): string' }],
  steps: ['Read the setting', 'Check it is there', 'Hand it back'], promises: [], estLines: 10,
});
const CONFIG = planned('src/config/env.ts');
const PRICING = planned('src/pricing/env.ts');
const EMPTY = skeleton('cfg', CONFIG);
const READS_ENV = EMPTY.replace("throw new Error('Not built yet');", "return process.env.HOME ?? '';");

let s: Scene;
let ctx: Ctx;
beforeAll(async () => {
  s = await scene();
  const seam = { id: 'cfg', name: 'Config', services: [], files: [CONFIG, PRICING] };
  const turn = { file: 'app/src/config/env.ts', agentId: 'builder-1' };
  ctx = {
    ...s.ctx,
    appRoot: resolve(s.ctx.root, 'app'),
    plan: { ...s.ctx.plan!, appRoot: 'app', seams: [seam] },
    lock: { version: 1, files: { ...lockFor('app/src/config/env.ts', EMPTY).files, ...lockFor('app/src/pricing/env.ts', EMPTY).files } },
    state: { ...s.ctx.state, turn: { ...s.ctx.state.turn, ...turn } },
  };
});

describe('an app folder inside the repo', () => {
  test('the file is found by the plan (from the app folder) and the lock (from the repo root)', async () => {
    await isAllowed(writes(s, 'app/src/config/env.ts', EMPTY, theBuilder(), ctx));
  });
  test('src/config/ is the app folder\'s: reading process.env there is allowed', async () => {
    await isAllowed(writes(s, 'app/src/config/env.ts', READS_ENV, theBuilder(), ctx));
  });
  test('and refused anywhere else in the app, with the file named as the plan spells it', async () => {
    const own = { ...ctx, state: { ...ctx.state, turn: { ...ctx.state.turn, file: 'app/src/pricing/env.ts' } } };
    expect(await reasonOf(writes(s, 'app/src/pricing/env.ts', READS_ENV, theBuilder(), own)))
      .toMatch(/^app\/src\/pricing\/env\.ts wasn't written: the file reads process\.env outside src\/config/);
  });
  test('a file in the app folder that the plan does not list is not in the plan', async () => {
    expect(await reasonOf(writes(s, 'app/src/other.ts', EMPTY, theBuilder(), ctx))).toMatch(/^app\/src\/other\.ts isn't in the plan/);
  });
  test('the repo root is not the app folder: the same name outside it is not in the plan either', async () => {
    expect(await reasonOf(writes(s, 'lib/config/env.ts', EMPTY, theBuilder(), ctx))).toMatch(/not in the plan/);
  });
});
