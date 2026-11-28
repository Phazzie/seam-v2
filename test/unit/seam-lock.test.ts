// R76: a seam script that changes protected files does all of it under ONE hold of the project lock (`.seam/.lock`), and the
// tamper check settles under the same lock. If the lock were let go between two steps (writing lock.json, then taking the
// snapshot that records it), a hook running at that moment could look at the new lock.json, find it different from the guard's
// record, and put the old one back. The tests check it two ways: by counting how often each script takes the lock and what is
// true when it lets go, and by holding the lock from another process and watching the script and the tamper check wait for it.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { approveCore } from '../../src/cli/approve.ts';
import { editFile } from '../../src/cli/edit.ts';
import { repair } from '../../src/cli/repair.ts';
import { requestApproval } from '../../src/cli/request.ts';
import { loadLock } from '../../src/formats/lock.ts';
import { loadState } from '../../src/formats/state.ts';
import { checkTamper } from '../../src/guard/tamper.ts';
import type { LockLimits } from '../../src/lib/lock.ts';
import { hashOf, loadRecord } from '../../src/guard/tamperrecord.ts';
import type { HookInput } from '../../src/types.ts';
import { makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { PLAN_TEXT, TOTAL, planFile, skeleton, total } from '../helpers/code.ts';
import { window } from '../helpers/cli.ts';
import { put, tempDir } from '../helpers/project.ts';
import { ctxOf } from '../helpers/tamper.ts';

/** One entry for each time the project lock of `watched` was taken, with what was true then and just before it was let go. */
interface Hold { atTake: Facts; atRelease: Facts }
interface Facts { lockJson: boolean; lockInRecord: boolean; phase: string; pending: boolean }

const holds: Hold[] = [];
let watched = '';

function facts(root: string): Facts {
  const lock = join(root, '.seam/lock.json');
  const record = loadRecord({ root, dataDir: dataDirOf }) ?? null;
  const entry = record?.files['.seam/lock.json'];
  return {
    lockJson: existsSync(lock),
    lockInRecord: entry !== undefined && existsSync(lock) && hashOf(lock) === entry.hash,
    phase: loadState(root)?.phase ?? '',
    pending: existsSync(join(root, '.seam/pending.json')),
  };
}
let dataDirOf = '';

vi.mock('../../src/lib/lock.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/lock.ts')>();
  return {
    ...real,
    withLock: (root: string, fn: () => unknown, limits?: LockLimits): unknown => {
      const run = fn as () => never;
      if (root !== watched) return real.withLock(root, run, limits);
      const hold: Hold = { atTake: facts(root), atRelease: facts(root) };
      holds.push(hold);
      return real.withLock(root, () => {
        try {
          return run();
        } finally {
          hold.atRelease = facts(root);
        }
      }, limits);
    },
  };
});

beforeEach(() => {
  holds.length = 0;
});

const skeletons = (): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const path of [TOTAL, 'src/greeting/Greeting.tsx']) {
    const { seam, file } = planFile(path);
    files[path] = skeleton(seam, file);
  }
  return files;
};

/** An app in `phase` with its record taken, watched from now on (what `holds` counts). */
async function appIn(phase: 'tests' | 'build', opts: { lock?: boolean } = {}): Promise<App> {
  const app = await makeApp({ phase, snapshot: true, files: skeletons(), ...opts });
  watched = app.root;
  dataDirOf = app.dataDir;
  holds.length = 0;
  return app;
}

describe('each script takes the project lock once, and does all its work inside it', () => {
  test('the freeze approval: lock.json is written and recorded, the phase moves, the request is used up, all before the lock is let go', async () => {
    const app = await appIn('tests');
    requestApproval(ctxOf(app), 'freeze');
    holds.length = 0;
    const code = JSON.parse(app.read('.seam/pending.json')).code as string;
    expect(approveCore({ typed: code }, ctxOf(app))).toMatchObject({ ok: true, phase: 'build' });
    expect(holds).toHaveLength(1);
    expect(holds[0].atTake).toEqual({ lockJson: false, lockInRecord: false, phase: 'tests', pending: true });
    expect(holds[0].atRelease).toEqual({ lockJson: true, lockInRecord: true, phase: 'build', pending: false });
  });

  test('another approval: the phase move and the request used up are recorded in one hold', async () => {
    const app = await appIn('build');
    requestApproval(ctxOf(app), 'park');
    holds.length = 0;
    const code = JSON.parse(app.read('.seam/pending.json')).code as string;
    expect(approveCore({ typed: code }, ctxOf(app)).ok).toBe(true);
    expect(holds).toHaveLength(1);
    expect(holds[0].atRelease.pending).toBe(false);
    expect(loadRecord(ctxOf(app))?.files['.seam/pending.json']).toBeUndefined();
  });

  test('a wrong code takes the lock once too, and leaves everything as it was', async () => {
    const app = await appIn('tests');
    requestApproval(ctxOf(app), 'freeze');
    holds.length = 0;
    expect(approveCore({ typed: 'XXXX' }, ctxOf(app)).ok).toBe(false);
    expect(holds.length).toBeLessThanOrEqual(1);
    expect(existsSync(app.abs('.seam/lock.json'))).toBe(false);
  });

  test('seam request: the request is written and taken into the record in one hold', async () => {
    const app = await appIn('tests');
    requestApproval(ctxOf(app), 'freeze');
    expect(holds).toHaveLength(1);
    expect(holds[0].atTake.pending).toBe(false);
    expect(holds[0].atRelease.pending).toBe(true);
    const entry = loadRecord(ctxOf(app))?.files['.seam/pending.json'];
    expect(entry?.hash).toBe(hashOf(app.abs('.seam/pending.json')));
  });

  test('seam edit: the lock entry, the record and the log line are one hold', async () => {
    const app = await appIn('build', { lock: true });
    app.writeRaw(TOTAL, total({ params: 'a: number, b: number, c = 0' }));
    holds.length = 0;
    const w = window(['yes']);
    expect(await editFile(w.io, () => ctxOf(app), TOTAL, app.root)).toBe(0);
    expect(holds).toHaveLength(1);
    expect(holds[0].atRelease.lockInRecord).toBe(true);
    expect(loadRecord(ctxOf(app))?.files[TOTAL]?.hash).toBe(hashOf(app.abs(TOTAL)));
    expect(loadLock(app.root)?.files[TOTAL]).toBeDefined();
  });

  test('seam repair: looking, putting back and logging are one hold', async () => {
    const app = await appIn('build', { lock: true });
    app.writeRaw('plan/plan.json', 'garbage {');
    holds.length = 0;
    const w = window([], { byShortcut: () => false });
    expect(await repair(w.io, { root: app.root, dataDir: app.dataDir })).toBe(0);
    expect(holds).toHaveLength(1);
    expect(app.read('plan/plan.json')).toBe(PLAN_TEXT);
    expect(app.read('.seam/log.md')).toMatch(/Owner ran repair: put back plan\/plan\.json/);
  });
});

const LOCK_MODULE = pathToFileURL(resolve(import.meta.dirname, '../../src/lib/lock.ts')).href;
const HELD_FOR_MS = 2500;
const WAITED_AT_LEAST_MS = 1500;

/** Take the project lock in another process and hold it for HELD_FOR_MS; resolves once it is held. The returned function waits for it to be let go. */
async function holdLockElsewhere(root: string): Promise<() => Promise<void>> {
  const dir = tempDir();
  put(dir, 'hold.mjs', [
    "import { writeSync } from 'node:fs';",
    `import { withLock } from ${JSON.stringify(LOCK_MODULE)};`,
    'withLock(process.argv[2], () => {',
    "  writeSync(1, 'held\\n');",
    `  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${HELD_FOR_MS});`,
    '});',
    '',
  ].join('\n'));
  const child = spawn(process.execPath, [join(dir, 'hold.mjs'), root], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const gone = new Promise<void>((done) => child.on('close', () => done()));
  await new Promise<void>((held, failed) => {
    child.stdout.on('data', (chunk: Buffer) => chunk.toString().includes('held') && held());
    child.on('close', () => failed(new Error('The process that holds the lock ended without holding it.')));
  });
  return () => gone;
}

describe('the others wait for the lock while it is held', () => {
  test('the tamper check settles under the lock: a file put back, but only once the lock is let go', async () => {
    const app = await makeApp({ phase: 'build', lock: true });
    watched = '';
    app.writeRaw('plan/plan.json', `${PLAN_TEXT}\n`); // a protected file changed behind the guard
    const released = await holdLockElsewhere(app.root);
    const started = Date.now();
    const input = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: {}, cwd: app.root } as HookInput;
    const { problems } = await checkTamper(input, ctxOf(app));
    expect(Date.now() - started, 'it did not wait for the lock').toBeGreaterThanOrEqual(WAITED_AT_LEAST_MS);
    expect(problems).toEqual(['plan/plan.json was changed outside the rules and has been put back']);
    expect(readFileSync(app.abs('plan/plan.json'), 'utf8')).toBe(PLAN_TEXT);
    await released();
  });

  test('the freeze approval waits for the lock too, and then goes through whole', async () => {
    const app = await appIn('tests');
    requestApproval(ctxOf(app), 'freeze');
    const code = JSON.parse(app.read('.seam/pending.json')).code as string;
    watched = '';
    const released = await holdLockElsewhere(app.root);
    const started = Date.now();
    expect(approveCore({ typed: code }, ctxOf(app))).toMatchObject({ ok: true, phase: 'build' });
    expect(Date.now() - started, 'it did not wait for the lock').toBeGreaterThanOrEqual(WAITED_AT_LEAST_MS);
    expect(loadState(app.root)?.phase).toBe('build');
    expect(existsSync(app.abs('.seam/lock.json'))).toBe(true);
    await released();
    rmSync(app.abs('.seam/pending.json'), { force: true });
  });
});
