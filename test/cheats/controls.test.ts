// Positive controls: legitimate actions the guard must NOT refuse. A guard that refuses everything
// would pass every cheat test, so these keep the cheat suite honest.
//
// The builder control needs the protected-file snapshot (`makeApp` with a lock takes one), which is
// Task 12's: until then it fails with "not implemented". The others run against the real write decision.
import { describe, test } from 'vitest';
import { asBuilder, asMain, makeApp } from '../helpers/app.ts';
import { expectAllowed, write } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';

describe('controls: the guard lets legitimate work through', () => {
  test('the builder whose turn it is can Write the correctly filled total (header, steps, signature intact)', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn: { file: TOTAL, agentId: 'builder-1' } });
    expectAllowed(await app.hook(write(app, TOTAL, total(), asBuilder('builder-1'))));
  });

  test('the main agent can Write a schema-only contract in plan2 (cheat 15 forbids code in one, not schemas)', async () => {
    const app = await makeApp({ phase: 'plan2' });
    const schema = 'export const Order = z.object({ id: z.string() })\n';
    expectAllowed(await app.hook(write(app, 'contracts/order.ts', schema, asMain())));
  });

  // The same input the cheat 20 throw and hang tests send, without the env switch.
  test('control for cheat 20: the main agent can Write notes.md when nothing is forced to fail', async () => {
    const app = await makeApp({ phase: 'build' });
    expectAllowed(await app.hook(write(app, 'notes.md', 'hello\n', asMain())));
  });
});
