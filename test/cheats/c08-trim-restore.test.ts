// Cheat 8: write code, trim the header so it passes, then restore it afterwards.
// Closed by: no AI writes code before the build, and in the build the header, the signatures and
// the turn are all checked on every write.
import { describe, test } from 'vitest';
import { formatHeader } from '../../src/formats/header.ts';
import { asBuilder, makeApp } from '../helpers/app.ts';
import { expectDenied, write } from '../helpers/calls.ts';
import { TOTAL, planFile, total } from '../helpers/code.ts';

const turn = { file: TOTAL, agentId: 'builder-1' };

describe('cheat 8: trimming the header, then restoring it with a changed signature', () => {
  test('real code with the promises trimmed out of the header is refused', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    const { seam, file } = planFile(TOTAL);
    const trimmed = formatHeader(seam, file).split('\n').filter((line) => !line.includes('P-pricing-')).join('\n');
    const r = await app.hook(write(app, TOTAL, total({ header: trimmed }), asBuilder('builder-1')));
    expectDenied(r, /header/i);
  });

  test('the header put back but the signature changed is refused too', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    const r = await app.hook(write(app, TOTAL, total({ params: 'a: number, b: string' }), asBuilder('builder-1')));
    expectDenied(r, /signature/i);
  });
});
