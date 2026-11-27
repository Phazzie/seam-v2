// Positive controls: legitimate actions the guard must NOT refuse. A guard that refuses everything
// would pass every cheat test, so these keep the cheat suite honest.
//
// Against the stub hook (which allows everything):
//   - the builder control needs the Task 6 lock writer, so it fails now with "not implemented";
//   - the notes.md control passes now, and has to keep passing once the real guard exists.
import { describe, test } from 'vitest';
import { asBuilder, asMain, makeApp } from '../helpers/app.ts';
import { expectAllowed, write } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';

describe('controls: the guard lets legitimate work through', () => {
  test('the builder whose turn it is can Write the correctly filled total (header, steps, signature intact)', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn: { file: TOTAL, agentId: 'builder-1' } });
    expectAllowed(await app.hook(write(app, TOTAL, total(), asBuilder('builder-1'))));
  });

  // The same input the cheat 20 throw and hang tests send, without the env switch.
  test('control for cheat 20: the main agent can Write notes.md when nothing is forced to fail', async () => {
    const app = await makeApp({ phase: 'build' });
    expectAllowed(await app.hook(write(app, 'notes.md', 'hello\n', asMain())));
  });
});
