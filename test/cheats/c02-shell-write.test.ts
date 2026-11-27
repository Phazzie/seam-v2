// Cheat 2: write the same code through a shell command instead of a file tool.
// Closed by: the command allowlist, and a tamper check after every tool (the file is put back).
import { existsSync } from 'node:fs';
import { describe, test, expect } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { expectBlocked, expectDenied, post, run, write } from '../helpers/calls.ts';
import { planFile, skeleton, TOTAL, total } from '../helpers/code.ts';

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

  test('a skeleton already written before the lock, overwritten through a command, is put back (R15)', async () => {
    const { seam, file } = planFile(TOTAL);
    const app = await makeApp({ phase: 'skeleton', snapshot: true, files: { [TOTAL]: skeleton(seam, file) } });
    app.writeRaw(TOTAL, total());
    expectBlocked(await app.hook(post('PowerShell', { command: `Set-Content ${TOTAL}` })), /total.ts/);
    expect(app.read(TOTAL)).toBe(skeleton(seam, file));
  });

  test('and the main AI that did it is halted: nothing more is written until the owner looks', async () => {
    const app = await makeApp({ phase: 'skeleton', snapshot: true });
    app.writeRaw(TOTAL, total());
    expectBlocked(await app.hook(post('Bash', { command: `cat > ${TOTAL}` })), /total.ts/);
    expect(JSON.parse(app.read('.seam/state.json')).halted).toBe(`the main AI changed a protected file: ${TOTAL}`);
    expectDenied(await app.hook(write(app, 'notes.md', 'x')), /halted/i);
    expectDenied(await app.hook(run('Bash', 'git status')), /halted/i);
  });
});
