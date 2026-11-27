// Positive controls: legitimate actions the guard must NOT refuse. A guard that refuses everything
// would pass every cheat test, so these keep the cheat suite honest.
//
// The builder control needs the protected-file snapshot (`makeApp` with a lock takes one), which is
// Task 12's: until then it fails with "not implemented". The others run against the real write decision.
import { beforeAll, describe, test } from 'vitest';
import { asBuilder, asMain, makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, run, write } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';
import type { Phase } from '../../src/types.ts';

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

  // Task 3's review: a guard that refused every command would pass all the command cheats (2, 7, 10, 12, 21).
  // These run the real hook in a seam project, in the phases the cheats use, and in both shells. The tests run only
  // in the build and flip phases (R59), so the other phases' controls are the commands that are always allowed.
  const ALWAYS: ['Bash' | 'PowerShell', string][] = [
    ['Bash', 'git status'], ['PowerShell', 'git status'], ['Bash', 'npm run typecheck'], ['PowerShell', 'npm run typecheck'],
    ['Bash', 'seam report'], ['PowerShell', 'seam status'], ['Bash', 'git log --oneline -5'], ['Bash', 'git diff'], ['Bash', 'node --version'],
  ];
  const TESTS: ['Bash' | 'PowerShell', string][] = [
    ['Bash', 'npm test'], ['PowerShell', 'npm test'], ['Bash', 'npm run test'], ['Bash', 'npx vitest run test/total.test.ts'], ['PowerShell', 'npx vitest run'],
  ];
  describe.each<[Phase, ['Bash' | 'PowerShell', string][]]>([
    ['plan1', ALWAYS], ['skeleton', ALWAYS], ['build', [...ALWAYS, ...TESTS]], ['flip', [...ALWAYS, ...TESTS]],
  ])('control for the command cheats, in %s', (phase, commands) => {
    let app: App;
    beforeAll(async () => {
      app = await makeApp({ phase });
    });
    test.each(commands)('the main agent can run %s: %s', async (tool, command) => {
      expectAllowed(await app.hook(run(tool, command, asMain())));
    });
  });
});
