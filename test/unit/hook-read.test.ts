// decideRead through the real bundled hook, as Claude Code runs it: a builder reads what it may, is refused
// what it may not (with the reason), and everyone else reads freely. The allowed cases are the controls for
// the refusals: a guard that refused every read would pass the refusals alone.
import { beforeAll, describe, test } from 'vitest';
import { asBuilder, asChecker, asMain, makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectAllowed, expectDenied, pre } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';

let app: App;
beforeAll(async () => {
  app = await makeApp({
    phase: 'build',
    turn: { file: TOTAL, agentId: 'builder-1' },
    files: { 'tests/total.test.ts': 'x\n', 'contracts/order.ts': 'x\n', '.seam/review/total.ts': 'x\n', 'notes.md': 'x\n' },
  });
});

const builder = asBuilder('builder-1');
const describer = { agent_id: 'describer-1', agent_type: 'seam-v2:describer' };

describe('a builder, through the hook', () => {
  test('reads its own file and the contracts, and searches the contracts', async () => {
    expectAllowed(await app.hook(pre('Read', { file_path: app.abs(TOTAL) }, builder)));
    expectAllowed(await app.hook(pre('Read', { file_path: app.abs('contracts/order.ts') }, builder)));
    expectAllowed(await app.hook(pre('Grep', { pattern: 'Order', path: app.abs('contracts') }, builder)));
    expectAllowed(await app.hook(pre('Glob', { pattern: '*.ts', path: app.abs('contracts') }, builder)));
  });
  test('is refused a test, a search of the tests, and a search with no path', async () => {
    expectDenied(await app.hook(pre('Read', { file_path: app.abs('tests/total.test.ts') }, builder)), /builders don't read tests; you'll be told which promise failed/);
    expectDenied(await app.hook(pre('Grep', { pattern: 'total', path: app.abs('tests') }, builder)), /builders don't read tests/);
    expectDenied(await app.hook(pre('Glob', { pattern: '**/*.test.ts' }, builder)), /builders don't read tests/);
    expectDenied(await app.hook(pre('Grep', { pattern: 'total' }, builder)), /search must give a path/);
  });
  test('is refused a file that is not its own, and another builder has nothing to read', async () => {
    expectDenied(await app.hook(pre('Read', { file_path: app.abs('notes.md') }, builder)), /isn't something a builder reads/);
    expectDenied(await app.hook(pre('Read', { file_path: app.abs(TOTAL) }, asBuilder('builder-2'))), /isn't this builder's turn/);
  });
});

describe('everyone else, through the hook', () => {
  test('the main AI and a checker read tests, and search with no path', async () => {
    for (const who of [asMain(), asChecker()]) {
      expectAllowed(await app.hook(pre('Read', { file_path: app.abs('tests/total.test.ts') }, who)));
      expectAllowed(await app.hook(pre('Grep', { pattern: 'total' }, who)));
      expectAllowed(await app.hook(pre('Glob', { pattern: '**/*.test.ts' }, who)));
    }
  });
  test('a describer reads the review folder and nothing else', async () => {
    expectAllowed(await app.hook(pre('Read', { file_path: app.abs('.seam/review/total.ts') }, describer)));
    expectDenied(await app.hook(pre('Read', { file_path: app.abs(TOTAL) }, describer)), /a describer reads only/);
  });
});
