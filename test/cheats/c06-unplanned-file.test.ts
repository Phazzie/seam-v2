// Cheat 6: put code in a folder the guard does not watch.
// Closed by: every code file anywhere must be in the plan.
import { describe, test } from 'vitest';
import { asBuilder, asMain, makeApp } from '../helpers/app.ts';
import { expectDenied, write } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';

const STASH = 'export const stash: string[] = [];\n';

describe('cheat 6: a code file that is not in the plan', () => {
  test('skeleton phase: the main agent cannot Write lib/stash.ts', async () => {
    const app = await makeApp({ phase: 'skeleton' });
    expectDenied(await app.hook(write(app, 'lib/stash.ts', STASH, asMain())), /not in the plan/i);
  });

  test('build phase: a builder cannot Write lib/stash.ts', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn: { file: TOTAL, agentId: 'builder-1' } });
    expectDenied(await app.hook(write(app, 'lib/stash.ts', STASH, asBuilder('builder-1'))), /not in the plan/i);
  });
});
