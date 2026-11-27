// Cheat 10: edit the guard itself or its records.
// Closed by: the plugin's files and .seam/ are protected, and anything changed behind the guard's
// back is put back by the tamper check.
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { expectBlocked, expectDenied, post, pre, run } from '../helpers/calls.ts';

describe('cheat 10: tampering with the guard or its records', () => {
  test('the main agent cannot Edit a file under the plugin root', async () => {
    const app = await makeApp({ phase: 'build' });
    const file_path = join(app.pluginRoot, 'dist', 'hook.mjs');
    const r = await app.hook(pre('Edit', { file_path, old_string: 'import', new_string: 'import' }));
    expectDenied(r, /plugin|guard|protected/i);
  });

  test('PowerShell Remove-Item .seam -Recurse is refused', async () => {
    const app = await makeApp({ phase: 'build' });
    expectDenied(await app.hook(run('PowerShell', 'Remove-Item .seam -Recurse -Force')));
  });

  test('a lock.json rewritten behind the guard is blocked and restored', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const original = app.read('.seam/lock.json');
    app.writeRaw('.seam/lock.json', '{"version":1,"files":{"tampered":{"kind":"whole","hash":"0"}}}');
    const r = await app.hook(post('Bash', { command: 'echo {} > .seam/lock.json' }));
    expectBlocked(r, /lock\.json/);
    expect(app.read('.seam/lock.json')).toBe(original);
  });
});
