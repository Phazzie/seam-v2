// Cheat 1 (spec section 9): write real code during the skeleton phase.
// Closed by: only the skeleton script writes code files in that phase.
import { describe, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { expectDenied, write } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';

describe('cheat 1: real code in the skeleton phase', () => {
  test('the main agent cannot Write the real total', async () => {
    const app = await makeApp({ phase: 'skeleton' });
    const r = await app.hook(write(app, TOTAL, total()));
    expectDenied(r, /only builders write app code/i);
  });
});
