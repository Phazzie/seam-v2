// Cheat 5: edit the file list (the plan) during the build.
// Closed by: the plan is frozen and fingerprinted.
import { describe, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { edit, expectDenied } from '../helpers/calls.ts';

describe('cheat 5: editing the plan in the build phase', () => {
  test('the main agent cannot Edit plan/plan.json', async () => {
    const app = await makeApp({ phase: 'build' });
    const r = await app.hook(edit(app, 'plan/plan.json', '"estLines": 25', '"estLines": 5'));
    expectDenied(r, /frozen|protected/i);
  });
});
