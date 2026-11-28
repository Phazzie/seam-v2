// An incomplete setup (R77): a project whose .seam/env.json is gone, or names a data folder that no longer exists. The commands say so
// in plain words (no "seam repair", no environment variable names), and `seam init` run again from Claude Code makes it whole.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadState } from '../../src/formats/state.ts';
import { makeApp } from '../helpers/app.ts';
import { folderAt, folderOf } from '../helpers/cli.ts';
import { tempDir } from '../helpers/project.ts';

const INCOMPLETE = /This project's setup is incomplete; run seam init again from Claude Code\./;
const NO_JARGON = /seam repair|SEAM_DATA_DIR|env\.json|CLAUDE_PLUGIN/;

describe('no .seam/env.json', () => {
  test.each([['report', ['report']], ['request', ['request', 'park']], ['install-shortcut', ['install-shortcut']]])('%s says the setup is incomplete, plainly', async (_name, args) => {
    const app = await makeApp({ phase: 'build', lock: true });
    rmSync(app.abs('.seam/env.json'));
    const r = await folderOf(app).cli(args, { SEAM_DATA_DIR: '' });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(INCOMPLETE);
    expect(r.stderr).not.toMatch(NO_JARGON);
  });

  test('seam init run again makes it whole: env.json is back, the state is as it was, and the commands work', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const state = app.read('.seam/state.json');
    rmSync(app.abs('.seam/env.json'));
    const init = await folderOf(app).cli(['init']);
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(init.stdout).toMatch(/setup was incomplete and is whole again/);
    expect(JSON.parse(app.read('.seam/env.json'))).toEqual({ dataDir: app.dataDir });
    expect(JSON.parse(app.read('.seam/state.json'))).toEqual(JSON.parse(state)); // the same state (the file is written again, with a final newline)
    expect(app.read('.seam/log.md')).toMatch(/Seam project setup completed again/);
    const report = await folderOf(app).cli(['report'], { SEAM_DATA_DIR: '' });
    expect(report.exitCode, report.stderr).toBe(0);
    expect(report.stdout).toMatch(/Phase: build/);
  });
});

describe('an env.json that names a data folder that is gone', () => {
  test('the commands say the records folder no longer exists, plainly', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    rmSync(app.dataDir, { recursive: true, force: true });
    const r = await folderOf(app).cli(['report'], { SEAM_DATA_DIR: '' });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(`The folder that holds this project's guard records (${app.dataDir}) no longer exists`);
    expect(r.stderr).toMatch(/Run seam init again from Claude Code/);
    expect(r.stderr).not.toMatch(NO_JARGON);
  });

  test('seam init run again, with a data folder to use, sets it up afresh: env.json, the project list and the state\'s copy', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const state = app.read('.seam/state.json');
    rmSync(app.dataDir, { recursive: true, force: true });
    const fresh = join(tempDir(), 'data');
    const again = folderAt(app.root, fresh, app.pluginRoot);
    const init = await again.cli(['init']);
    expect(init.exitCode, init.stdout + init.stderr).toBe(0);
    expect(JSON.parse(app.read('.seam/env.json'))).toEqual({ dataDir: fresh });
    expect(JSON.parse(app.read('.seam/state.json'))).toEqual(JSON.parse(state)); // the same state (the file is written again, with a final newline)
    expect(existsSync(join(fresh, 'projects.json'))).toBe(true);
    expect(readFileSync(join(fresh, 'projects.json'), 'utf8')).toContain('seam-app-');
    expect(loadState(app.root)?.phase).toBe('build');
    const report = await again.cli(['report'], { SEAM_DATA_DIR: '' });
    expect(report.exitCode, report.stderr).toBe(0);
  });

  test('a project whose setup is whole is still "already a seam project"', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    const r = await folderOf(app).cli(['init']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/is a seam project already/);
  });
});

describe('a state.json that is missing or unreadable still points at repair', () => {
  test('that hint is for a damaged record, and only for that', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    app.writeRaw('.seam/state.json', '{"version": 1');
    const r = await folderOf(app).cli(['report']);
    expect(r.stderr).toMatch(/seam repair in your own terminal/);
  });
});
