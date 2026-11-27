// Cheat 21: start a background process early that writes later.
// Closed by: a command allowlist in every phase; background runs are refused.
import { describe, test } from 'vitest';
import { makeApp } from '../helpers/app.ts';
import { expectDenied, run } from '../helpers/calls.ts';

describe('cheat 21: background runs', () => {
  test.each<['Bash' | 'PowerShell', string]>([
    ['Bash', 'npm test &'],
    ['PowerShell', 'Start-Process node -ArgumentList x.js'],
    ['Bash', 'cmd /c start /b node x'],
    ['Bash', 'nohup node x'],
  ])('%s: %s is refused', async (tool, command) => {
    const app = await makeApp({ phase: 'plan1' });
    expectDenied(await app.hook(run(tool, command)), /background runs aren't allowed/i);
  });
});
