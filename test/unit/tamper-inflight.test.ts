// R73 (b): a call's own note in .seam/inflight stays until its tamper check has settled. Before, it was struck off as
// the check began, so another call's check that ran in between saw the write on disk, saw no note, and put it back.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { checkTamper } from '../../src/guard/tamper.ts';
import { asBuilder, makeApp } from '../helpers/app.ts';
import type { App } from '../helpers/app.ts';
import { post, write } from '../helpers/calls.ts';
import { TOTAL, total } from '../helpers/code.ts';
import { logOf } from '../helpers/inproc.ts';
import { ctxOf, decideFor, recordOf, stateOf } from '../helpers/tamper.ts';
import type { HookInput } from '../../src/types.ts';

vi.mock('../../src/guard/tamperjudge.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/guard/tamperjudge.ts')>();
  return { ...real, judge: vi.fn(real.judge) };
});
vi.mock('../../src/guard/tamperbuilder.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/guard/tamperbuilder.ts')>();
  return { ...real, verifierFor: vi.fn(real.verifierFor) };
});
import { verifierFor } from '../../src/guard/tamperbuilder.ts';
import { judge } from '../../src/guard/tamperjudge.ts';

const turn = { file: TOTAL, agentId: 'builder-1' };
const noted = (app: App): string[] => (JSON.parse(readFileSync(join(app.root, '.seam/inflight'), 'utf8')) as { id: string }[]).map((call) => call.id);

/** A builder's Write of its file, allowed before the tool ran; the tool has now written it. */
async function writing(app: App): Promise<HookInput> {
  const input = { cwd: app.root, ...write(app, TOTAL, total(), asBuilder('builder-1')), tool_use_id: 'w-1' } as HookInput;
  expect(await decideFor(app, input)).toEqual({ kind: 'allow' });
  app.writeRaw(TOTAL, total());
  return { ...input, hook_event_name: 'PostToolUse' };
}

describe('the note of a call under way', () => {
  test('is still there while the call\'s own check settles, and gone once it has', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    const after = await writing(app);
    expect(noted(app)).toEqual(['w-1']);
    const real = await vi.importActual<typeof import('../../src/guard/tamperjudge.ts')>('../../src/guard/tamperjudge.ts');
    const seen: string[][] = [];
    vi.mocked(judge).mockImplementation((c, f) => {
      seen.push(noted(app));
      return real.judge(c, f);
    });
    expect(await decideFor(app, after)).toEqual({ kind: 'allow' });
    expect(seen).toEqual([['w-1']]);
    expect(noted(app)).toEqual([]);
  });

  test('is struck off even when the check fails', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    const after = await writing(app);
    vi.mocked(judge).mockImplementation(() => {
      throw new Error('the check broke');
    });
    await expect(decideFor(app, after)).rejects.toThrow('the check broke');
    expect(noted(app)).toEqual([]);
  });

  test('keeps another call\'s check from putting back a write whose own check has begun but not settled', async () => {
    const app = await makeApp({ phase: 'build', lock: true, turn });
    const real = await vi.importActual<typeof import('../../src/guard/tamperjudge.ts')>('../../src/guard/tamperjudge.ts');
    vi.mocked(judge).mockImplementation(real.judge);
    const builder = await vi.importActual<typeof import('../../src/guard/tamperbuilder.ts')>('../../src/guard/tamperbuilder.ts');
    let slow = true; // the owner's check is the first to ask, and is held up for a moment before it settles: the other call's check goes first
    vi.mocked(verifierFor).mockImplementation(async (...args) => {
      const wait = slow;
      slow = false;
      if (wait) await new Promise((done) => setTimeout(done, 100));
      return builder.verifierFor(...args);
    });
    const after = await writing(app);
    const owner = checkTamper(after, ctxOf(app)); // has scanned, and waits to settle
    const reader = await checkTamper({ cwd: app.root, ...post('Read', { file_path: app.abs('notes.md') }), tool_use_id: 'r-1' } as HookInput, ctxOf(app));
    expect(reader.problems).toEqual([]);
    expect((await owner).problems).toEqual([]);
    expect(app.read(TOTAL)).toBe(total());
    expect(recordOf(app).files[TOTAL].size).toBe(Buffer.byteLength(total()));
    expect(stateOf(app)).toMatchObject({ halted: null, strikes: {} });
    expect(logOf(app.root)).not.toMatch(/put back|unattributed|strike|halted/i);
    expect(noted(app)).toEqual([]);
  });
});
