// Cheat 4: swap the approved steps for different ones during the build.
// Closed by: fingerprints of everything but the bodies (the step markers are fingerprinted).
import { describe, test } from 'vitest';
import { asBuilder, makeApp } from '../helpers/app.ts';
import { expectDenied, write } from '../helpers/calls.ts';
import { TOTAL, planFile, total } from '../helpers/code.ts';

describe('cheat 4: swapped steps in the build phase', () => {
  test('a builder who swaps step 1 and step 2 is refused, naming the step', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn: { file: TOTAL, agentId: 'builder-1' } });
    const [one, two, three] = planFile(TOTAL).file.steps;
    const r = await app.hook(write(app, TOTAL, total({ steps: [two, one, three] }), asBuilder('builder-1')));
    expectDenied(r, /step [12]\b.*total/i);
  });
});
