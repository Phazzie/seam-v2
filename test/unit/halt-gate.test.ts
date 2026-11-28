// R77: while a run is halted, the owner has to be able to start recovering. The AI may still run `seam report` (it only reads
// state) and `seam request park` / `seam request edit` (they only write .seam/pending.json, which only the owner's window acts
// on); every other write and command is refused, as before, with a message that points the owner at the Seam Approve window.
import { describe, expect, test } from 'vitest';
import { asBuilder, makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, expectDenied, pre, run, write } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';
import { updateState } from '../../src/lib/store.ts';

const HALTED = /The run is halted: because/;
const WINDOW = /Seam Approve window on your desktop/;

async function haltedApp(): Promise<App> {
  const app = await makeApp({ phase: 'build', lock: true });
  updateState(app.root, app.dataDir, (s) => ({ ...s, halted: 'because' }));
  return app;
}

describe('while the run is halted', () => {
  test.each(['seam report', 'seam status', 'seam request park', 'seam request edit', 'SEAM REQUEST EDIT'])('%s is allowed, from either shell', async (command) => {
    const app = await haltedApp();
    for (const tool of ['Bash', 'PowerShell'] as const) expectAllowed(await app.hook(run(tool, command)));
  });

  test('so are the same commands by the full plugin path', async () => {
    const app = await haltedApp();
    expectAllowed(await app.hook(run('Bash', `node "${app.pluginRoot}/dist/seam.mjs" report`)));
    expectAllowed(await app.hook(run('Bash', `node "${app.pluginRoot}/dist/seam.mjs" request edit`)));
  });

  test.each([
    'git status', 'seam request freeze', 'seam request features', 'seam request flips', 'seam request park extra', 'seam init', 'seam install-shortcut', 'seam help',
    'npm test', 'echo hi', 'git branch injected',
  ])('%s is refused, saying the run is halted and where to go', async (command) => {
    const app = await haltedApp();
    const reason = (await expectDeniedWith(app, command));
    expect(reason).toMatch(HALTED);
    expect(reason).toMatch(WINDOW);
  });

  test('a command that is never allowed (the owner\'s commands) is still refused, with the halt as the reason', async () => {
    const app = await haltedApp();
    for (const command of ['seam approve', 'seam window', 'seam edit x', 'seam repair']) expectDenied(await app.hook(run('Bash', command)), /./);
  });

  test('a write is refused, and the message points at the window', async () => {
    const app = await haltedApp();
    expectDenied(await app.hook(write(app, 'notes.md', 'x')), HALTED);
    expectDenied(await app.hook(write(app, 'notes.md', 'x')), WINDOW);
  });

  test('a builder gets no more than the main AI: its commands are refused as halted', async () => {
    const app = await haltedApp();
    expectDenied(await app.hook(run('Bash', 'seam report', asBuilder('b-1'))), HALTED);
  });

  test('reads stay open, so the owner and the AI can look', async () => {
    const app = await haltedApp();
    expectAllowed(await app.hook(pre('Read', { file_path: app.abs(TOTAL) })));
  });

  test('when the run is not halted nothing about commands changes', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    expectAllowed(await app.hook(run('Bash', 'git status')));
    expectAllowed(await app.hook(run('Bash', 'seam request park')));
  });
});

async function expectDeniedWith(app: App, command: string): Promise<string> {
  const r = await app.hook(run('Bash', command));
  expect(r.denied, `the hook allowed it: ${command}`).toBe(true);
  return r.reason;
}
