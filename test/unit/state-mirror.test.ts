// R78 (Codex on PR #23): every change to the state is made from `.seam/state.json` as it is, and written to the guard's copy of it
// in the data folder first. If state.json had been changed behind the guard (say, `phase` set to build) and then any refusal was
// recorded, the tampered state went into the copy, which is what the tamper check trusts: the change was laundered. Now, before
// the state is changed from, state.json is compared with the copy; if they differ, the copy wins (state.json is put back from it, and
// the log says so), and the change is made on top of that.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadState } from '../../src/formats/state.ts';
import { recordBlock, rootKey, updateState, writeState } from '../../src/lib/store.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { expectDenied, write } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';
import { logText, stateOf } from '../helpers/tamper.ts';

const mirrorFile = (app: App): string => join(app.dataDir, 'mirror', rootKey(app.root), 'state.json');
const mirrorOf = (app: App) => JSON.parse(readFileSync(mirrorFile(app), 'utf8')) as { phase: string; blocks: number };
const PUT_BACK = /\d\d:\d\d Put back \.seam\/state\.json, which was changed behind the guard\.\n/;

/** A project in the plan1 phase with its record taken (which makes the copy of state.json). */
const planning = (): Promise<App> => makeApp({ phase: 'plan1', snapshot: true });
/** What a command that edits state.json by hand does: the phase jumps ahead. */
const tamper = (app: App): void => app.writeRaw('.seam/state.json', app.read('.seam/state.json').replace('"phase": "plan1"', '"phase": "build"'));

describe('a state.json changed behind the guard is not copied into the guard\'s record', () => {
  test('after the tamper, a refusal is recorded: the copy keeps the real state, and state.json is put back from it', async () => {
    const app = await planning();
    tamper(app);
    expect(stateOf(app).phase).toBe('build');
    expectDenied(await app.hook(write(app, TOTAL, 'export const x = 1;\n')), /./); // the main AI may not write app code: a refusal, which is counted
    expect(stateOf(app)).toMatchObject({ phase: 'plan1', blocks: 1 });
    expect(mirrorOf(app)).toMatchObject({ phase: 'plan1', blocks: 1 });
    expect(logText(app)).toMatch(PUT_BACK);
    expect(logText(app)).toMatch(/Blocked: main tried Write/);
  });

  test('recordBlock and updateState, called directly, do the same', async () => {
    const app = await planning();
    tamper(app);
    recordBlock(app.root, app.dataDir, 'main', 'tried something');
    expect(loadState(app.root)).toMatchObject({ phase: 'plan1', blocks: 1 });
    expect(mirrorOf(app).phase).toBe('plan1');
    tamper(app);
    updateState(app.root, app.dataDir, (s) => ({ ...s, blocks: s.blocks + 5 }));
    expect(loadState(app.root)).toMatchObject({ phase: 'plan1', blocks: 6 });
    expect(logText(app).match(/Put back \.seam\/state\.json/g)).toHaveLength(2);
  });

  test('a state.json that was deleted, or filled with something that is not a state, is put back from the copy too', async () => {
    const gone = await planning();
    rmSync(gone.abs('.seam/state.json'));
    recordBlock(gone.root, gone.dataDir, 'main', 'tried something');
    expect(loadState(gone.root)).toMatchObject({ phase: 'plan1', blocks: 1 });
    const junk = await planning();
    junk.writeRaw('.seam/state.json', '{ not json');
    recordBlock(junk.root, junk.dataDir, 'main', 'tried something');
    expect(loadState(junk.root)).toMatchObject({ phase: 'plan1', blocks: 1 });
  });

  test('when state.json and the copy are the same nothing is put back and nothing is logged about it', async () => {
    const app = await planning();
    recordBlock(app.root, app.dataDir, 'main', 'tried something');
    recordBlock(app.root, app.dataDir, 'main', 'tried something else');
    expect(stateOf(app).blocks).toBe(2);
    expect(logText(app)).not.toMatch(/Put back/);
  });

  test('a project that has no copy yet (nothing wrote the state before) is left alone, and the first write makes the copy', async () => {
    const app = await makeApp({ phase: 'plan1' });
    expect(existsSync(mirrorFile(app))).toBe(false);
    recordBlock(app.root, app.dataDir, 'main', 'tried something');
    expect(stateOf(app).blocks).toBe(1);
    expect(mirrorOf(app).blocks).toBe(1);
    expect(logText(app)).not.toMatch(/Put back/);
  });

  test('a write that was interrupted after the copy was written (the copy is newer) is finished, not undone', async () => {
    const app = await planning();
    writeState(app.root, app.dataDir, { ...stateOf(app), blocks: 3 });
    app.writeRaw('.seam/state.json', readFileSync(join(app.root, '.seam/state.json'), 'utf8').replace('"blocks": 3', '"blocks": 2')); // state.json is one step behind
    recordBlock(app.root, app.dataDir, 'main', 'tried something');
    expect(stateOf(app).blocks).toBe(4);
  });
});
