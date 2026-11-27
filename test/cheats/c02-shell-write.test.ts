// Cheat 2: write the same code through a shell command instead of a file tool.
// Closed by: the command allowlist, and a tamper check after every tool (the file is put back).
import { existsSync } from 'node:fs';
import { describe, test, expect } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { expectBlocked, expectDenied, post, run } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';

describe('cheat 2: code written through a command', () => {
  test('Bash cat > total.ts is a command that is not allowed', async () => {
    const app = await makeApp({ phase: 'skeleton' });
    const r = await app.hook(run('Bash', `cat > ${TOTAL} <<'EOF'\n${total()}EOF`));
    expectDenied(r, /not allowed/i);
  });

  test('PowerShell Set-Content on total.ts is a command that is not allowed', async () => {
    const app = await makeApp({ phase: 'skeleton' });
    const r = await app.hook(run('PowerShell', `Set-Content -Path ${TOTAL} -Value @'\n${total()}'@`));
    expectDenied(r, /not allowed/i);
  });

  test('if the command ran anyway, the tamper check blocks and removes the file', async () => {
    const app = await makeApp({ phase: 'skeleton', snapshot: true });
    app.writeRaw(TOTAL, total());
    const r = await app.hook(post('Bash', { command: `cat > ${TOTAL}` }));
    expectBlocked(r, /total\.ts/);
    expect(existsSync(app.abs(TOTAL)), 'the stray code file is still in the app').toBe(false);
  });
});
