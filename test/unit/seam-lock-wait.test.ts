// R76 (the second half of seam-lock.test.ts): the tamper check and the freeze approval wait for the project lock while another process
// holds it. Together with "each script takes the lock once" this closes the gap between writing lock.json and recording it.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { approveCore } from '../../src/cli/approve.ts';
import { requestApproval } from '../../src/cli/request.ts';
import { loadState } from '../../src/formats/state.ts';
import { checkTamper } from '../../src/guard/tamper.ts';
import type { HookInput } from '../../src/types.ts';
import { makeApp } from '../helpers/app.ts';
import { appIn } from '../helpers/approving.ts';
import { PLAN_TEXT } from '../helpers/code.ts';
import { put, tempDir } from '../helpers/project.ts';
import { ctxOf } from '../helpers/tamper.ts';

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
