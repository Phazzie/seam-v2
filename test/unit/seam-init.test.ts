// `seam init` (Task 13): starts a seam project in a folder: the records, the entry in the project list, where the data
// folder is, the first snapshot of the protected files. And the whole way through, init -> freeze approval, leaves the
// tamper check with nothing to undo (I-3: every seam script that changes a protected file takes the change into the record).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { approveCore } from '../../src/cli/approve.ts';
import { loadPending } from '../../src/cli/pending.ts';
import { loadState } from '../../src/formats/state.ts';
import { resolveReal } from '../../src/lib/paths.ts';
import { rootKey, updateState } from '../../src/lib/store.ts';
import { expectAllowed, post, pre } from '../helpers/calls.ts';
import { TOTAL } from '../helpers/code.ts';
import { folderAt, plainFolder } from '../helpers/cli.ts';
import { put } from '../helpers/project.ts';

/** The check keeps a quarantine folder in the data folder, and makes it only when it moves something aside. */
const movedAside = (dataDir: string): boolean => existsSync(join(dataDir, 'quarantine'));

const recordOf = (dataDir: string, root: string): { files: Record<string, unknown>; code: string[] } =>
  JSON.parse(readFileSync(join(dataDir, 'mirror', rootKey(root), 'protected.json'), 'utf8')) as { files: Record<string, unknown>; code: string[] };

describe('seam init', () => {
  test('starts the records: state in phase setup with no blocks, the data folder written down, the project listed, a first snapshot, a log line', async () => {
    const f = plainFolder();
    const r = await f.cli(['init']);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(loadState(f.root)).toEqual({
      version: 1, phase: 'setup', turn: { agentId: null, file: null, startedAt: null }, strikes: {}, parked: [], done: [], approvals: [], blocks: 0, halted: null,
    });
    expect(JSON.parse(f.read('.seam/env.json'))).toEqual({ dataDir: f.dataDir });
    const listed = (JSON.parse(readFileSync(join(f.dataDir, 'projects.json'), 'utf8')) as { projects: string[] }).projects;
    expect(listed).toEqual([resolveReal(f.root, '.')]);
    expect(readFileSync(join(f.dataDir, 'mirror', rootKey(f.root), 'state.json'), 'utf8')).toBe(f.read('.seam/state.json'));
    expect(Object.keys(recordOf(f.dataDir, f.root).files).sort()).toEqual(['.seam/env.json', 'plan/plan.json']);
    expect(recordOf(f.dataDir, f.root).code.sort()).toEqual(['src/greeting/Greeting.tsx', TOTAL]);
    expect(f.read('.seam/log.md')).toMatch(/^\d\d:\d\d Seam project started\n$/);
    expect(r.stdout).toMatch(/started/i);
  });

  test('straight after init the tamper check finds nothing to undo (the first snapshot is complete)', async () => {
    const f = plainFolder();
    await f.cli(['init']);
    const r = await f.hook(post('Bash', { command: 'git status' }));
    expectAllowed(r);
    expect(r.stdout).toBe('');
    expect(movedAside(f.dataDir)).toBe(false);
    expect(loadState(f.root)?.halted).toBeNull();
  });

  test('the data folder comes from CLAUDE_PLUGIN_DATA when SEAM_DATA_DIR is not set, and later commands find it in .seam/env.json', async () => {
    const f = plainFolder();
    const r = await f.cli(['init'], { SEAM_DATA_DIR: '', CLAUDE_PLUGIN_DATA: f.dataDir });
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(f.read('.seam/env.json'))).toEqual({ dataDir: f.dataDir });
    const report = await f.cli(['report'], { SEAM_DATA_DIR: '' });
    expect(report.exitCode, report.stderr).toBe(0);
    expect(report.stdout).toMatch(/Phase: setup/);
  });

  test('with no data folder to be had it says what to set, and starts nothing', async () => {
    const f = plainFolder();
    const r = await f.cli(['init'], { SEAM_DATA_DIR: '', CLAUDE_PLUGIN_DATA: '' });
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/SEAM_DATA_DIR/);
    expect(existsSync(join(f.root, '.seam'))).toBe(false);
  });

  test('--app-root and --legacy are kept in .seam/env.json, and the folders have to be there', async () => {
    const f = plainFolder();
    mkdirSync(join(f.root, 'app'));
    mkdirSync(join(f.root, 'old'));
    const r = await f.cli(['init', '--app-root', 'app', '--legacy', 'old']);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(f.read('.seam/env.json'))).toEqual({ dataDir: f.dataDir, appRoot: 'app', legacyRoot: 'old' });
    expect(f.read('.seam/log.md')).toMatch(/Seam project started .*app.*old/);

    const g = plainFolder();
    const bad = await g.cli(['init', '--legacy', 'nowhere']);
    expect(bad.exitCode).toBe(1);
    expect(bad.stdout + bad.stderr).toMatch(/nowhere/);
    expect(existsSync(join(g.root, '.seam'))).toBe(false);
  });

  test('a folder that is a seam project already is not started again', async () => {
    const f = plainFolder();
    await f.cli(['init']);
    const before = f.read('.seam/state.json');
    const again = await f.cli(['init']);
    expect(again.exitCode).toBe(1);
    expect(again.stdout + again.stderr).toMatch(/already/i);
    expect(f.read('.seam/state.json')).toBe(before);
  });

  test('a folder inside a seam project is not started either', async () => {
    const f = plainFolder();
    await f.cli(['init']);
    mkdirSync(join(f.root, 'sub'));
    const r = await folderAt(join(f.root, 'sub'), f.dataDir, f.pluginRoot).cli(['init']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/already/i);
  });

  test('outside any seam project the other commands say so, and how to start one', async () => {
    const f = plainFolder();
    for (const args of [['report'], ['request', 'freeze'], ['install-shortcut']]) {
      const r = await f.cli(args);
      expect(r.exitCode, args.join(' ')).toBe(1);
      expect(r.stdout + r.stderr, args.join(' ')).toMatch(/not a seam project.*seam init/s);
    }
  });
});

describe('from init to the freeze approval: the tamper check has nothing to undo (I-3)', () => {
  test('init, then the tests phase, then a freeze is asked for and approved: the next Bash call is clean', async () => {
    const f = plainFolder();
    await f.cli(['init']);
    updateState(f.root, f.dataDir, (s) => ({ ...s, phase: 'tests' }));
    // the main AI writes a test with the Write tool: the hook lets it through before, and takes the new file into its record after
    const written = { file_path: join(f.root, 'tests/total.test.ts'), content: "import { total } from '../src/pricing/total.ts';\nexport const x = total;\n" };
    expectAllowed(await f.hook(pre('Write', written)));
    put(f.root, 'tests/total.test.ts', written.content);
    expectAllowed(await f.hook(post('Write', written)));

    const requested = await f.cli(['request', 'freeze']);
    expect(requested.exitCode, requested.stdout + requested.stderr).toBe(0);
    const approved = approveCore({ typed: loadPending(f.root)!.code }, f.ctx());
    expect(approved).toEqual({ ok: true, kind: 'freeze', phase: 'build' });
    expect(existsSync(join(f.root, '.seam/lock.json'))).toBe(true);

    const check = await f.hook(post('Bash', { command: 'git status' }));
    expectAllowed(check);
    expect(check.stdout, 'the tamper check had something to say').toBe('');
    expect(loadState(f.root)).toMatchObject({ phase: 'build', halted: null, blocks: 0 });
    expect(movedAside(f.dataDir)).toBe(false);
    expect(Object.keys(recordOf(f.dataDir, f.root).files)).toEqual(expect.arrayContaining(['.seam/lock.json', 'plan/plan.json', TOTAL, 'tests/total.test.ts']));
    expect(f.read('.seam/log.md')).not.toMatch(/put back|moved aside|halted/i);
  });
});
