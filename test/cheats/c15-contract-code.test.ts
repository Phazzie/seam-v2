// Cheat 15: hide real logic inside a contract.
// Closed by: contracts may hold only schemas and types.
import { describe, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { expectDenied, write } from '../helpers/calls.ts';

const ORDER = [
  "import { z } from 'zod';",
  '',
  'export const OrderId = z.string().refine(s => s.length > 2);',
  '',
].join('\n');

describe('cheat 15: code inside a contract', () => {
  test('a contract with a .refine function is refused', async () => {
    const app = await makeApp({ phase: 'plan2' });
    expectDenied(await app.hook(write(app, 'contracts/order.ts', ORDER)), /contracts may not contain code/i);
  });
});
