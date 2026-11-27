// Cheat 3: mark a seam green or "done" by hand, then write the code afterwards.
// Closed by: done and green are set only by a script from guard records.
import { describe, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { expectDenied, write } from '../helpers/calls.ts';

describe('cheat 3: faking "done" in the state file', () => {
  test('the main agent cannot Write .seam/state.json to mark files done', async () => {
    const app = await makeApp({ phase: 'build' });
    const state = JSON.parse(app.read('.seam/state.json')) as Record<string, unknown>;
    state.done = ['src/pricing/total.ts', 'src/greeting/Greeting.tsx'];
    const r = await app.hook(write(app, '.seam/state.json', JSON.stringify(state, null, 2)));
    expectDenied(r, /records|protected|scripts/i);
  });
});
