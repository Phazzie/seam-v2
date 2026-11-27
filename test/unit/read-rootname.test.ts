// Carried from Task 11's review: a refusal for the project folder itself (or '.') said "  isn't something a
// builder reads", with an empty name. It names the folder as '.'.
import { describe, expect, test } from 'vitest';
import { asBuilder, makeApp } from '../helpers/app.ts';
import { pre } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';
import { call, reasonOf } from '../helpers/inproc.ts';

const describer = { agent_id: 'd-1', agent_type: 'seam-v2:describer' };

describe('a refusal for the project folder has a name', () => {
  test.each([['the folder', (root: string) => root], ['a dot', () => '.']])('a builder reading %s is told what it may read', async (_name, path) => {
    const app = await makeApp({ phase: 'build', turn: { file: TOTAL, agentId: 'b-1' } });
    const reason = reasonOf(await call(app, pre('Read', { file_path: path(app.root) }, asBuilder('b-1'))));
    expect(reason).toMatch(/^\. isn't something a builder reads/);
  });

  test('a describer reading the folder is told it is not in its copy', async () => {
    const app = await makeApp({ phase: 'build' });
    const reason = reasonOf(await call(app, pre('Read', { file_path: app.root }, describer)));
    expect(reason).toMatch(/and \. isn't in it/);
  });
});
