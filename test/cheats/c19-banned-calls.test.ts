// Cheat 19: code under test reaches the guard's records, or notices it is being tested.
// Closed by: builder bodies may not use fs, dynamic import or require.
//
// Each reason must name the banned call itself. A deny for some other reason (the extra import is
// not in the plan, say) must not satisfy these, so none of the patterns match that wording.
import { describe, test } from 'vitest';
import { asBuilder, makeApp } from '../helpers/app.ts';
import { expectDenied, write } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';
import type { TotalOptions } from '../helpers/code.ts';

const turn = { file: TOTAL, agentId: 'builder-1' };

describe('cheat 19: banned calls in a builder body', () => {
  test.each<[string, TotalOptions, RegExp]>([
    ["require('fs')", { body: ["const fs = require('fs');", 'void fs;'] }, /\brequire\b/i],
    ["import('fs')", { body: ["void import('fs');"] }, /dynamic import|import\(/i],
    [
      'fs.writeFileSync',
      { top: ["import * as fs from 'node:fs';"], body: ["fs.writeFileSync('x', 'y');"] },
      /fs\/require\/dynamic import|writeFileSync/i,
    ],
  ])('a builder using %s is refused, naming it', async (_name, options, naming) => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    expectDenied(await app.hook(write(app, TOTAL, total(options), asBuilder('builder-1'))), naming);
  });
});
