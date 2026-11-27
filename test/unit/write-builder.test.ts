// decideWrite, the role table, part 3 (rule 4 and rule 6 for builders): a builder writes only in the
// build phase, only its own file, and only when the text keeps the plan, the signatures, the steps and
// the house rules. Each case asks the decision directly.
import { rmSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { PHASES } from '../../src/types.ts';
import { asBuilder } from '../helpers/app.ts';
import { TOTAL, total } from '../helpers/code.ts';
import { lockOf } from '../helpers/lockcheck.ts';
import { ask, edits, inPhase, isAllowed, reasonOf, scene, theBuilder, writes } from '../helpers/decide.ts';
import type { Scene } from '../helpers/decide.ts';

let s: Scene;
beforeAll(async () => {
  s = await scene();
});

const GREETING = 'src/greeting/Greeting.tsx';
const built = (text = total()) => writes(s, TOTAL, text, theBuilder());
const long = (n: number): string => `${total()}${'// padding\n'.repeat(n)}`;

describe('rule 4: the builder whose turn it is writes the file, if the text keeps the rules', () => {
  test('the correctly filled total is allowed', async () => await isAllowed(built()));
  test('so is an Edit that fills in the body of the skeleton on disk', async () => {
    await isAllowed(edits(s, TOTAL, "throw new Error('Not built yet');", 'return a + b;', theBuilder()));
  });
  test('a path spelled another way is the same file', async () => {
    await isAllowed(ask(s, 'Write', { file_path: s.app.abs('src/greeting/../pricing/total.ts'), content: total() }, theBuilder()));
  });
  test.runIf(process.platform === 'win32')('and so is the same path in other letter case', async () => {
    await isAllowed(ask(s, 'Write', { file_path: s.app.abs('SRC\\Pricing\\TOTAL.ts'), content: total() }, theBuilder()));
  });
  test('MultiEdit applies its edits in order', async () => {
    const multi = ask(s, 'MultiEdit', {
      file_path: s.app.abs(TOTAL),
      edits: [{ old_string: "throw new Error('Not built yet');", new_string: 'const sum = a + b;' }, { old_string: 'const sum = a + b;', new_string: 'return a + b;' }],
    }, theBuilder());
    await isAllowed(multi);
  });
});

describe('rule 4: only in the build phase', () => {
  test.each(PHASES.filter((p) => p !== 'build'))('refused in %s', async (phase) => {
    expect(await reasonOf(writes(s, TOTAL, total(), theBuilder(), inPhase(s, phase)))).toMatch(new RegExp(`only during the build phase.*${phase}`));
  });
});

describe('rule 4: only on its turn, for its file', () => {
  test("another agent id is not this builder's turn", async () => {
    expect(await reasonOf(writes(s, TOTAL, total(), asBuilder('builder-2')))).toBe("it isn't this builder's turn for src/pricing/total.ts");
  });
  test('a builder with no agent id is refused too', async () => {
    expect(await reasonOf(writes(s, TOTAL, total(), { agent_type: 'seam-v2:builder' }))).toMatch(/isn't this builder's turn/);
  });
  test('nobody\'s turn (no turn recorded)', async () => {
    const ctx = inPhase(s, 'build', { file: null, agentId: null });
    expect(await reasonOf(writes(s, TOTAL, total(), theBuilder(), ctx))).toMatch(/isn't this builder's turn for src\/pricing\/total\.ts/);
  });
  test('a turn for another file', async () => {
    const ctx = inPhase(s, 'build', { file: GREETING });
    expect(await reasonOf(writes(s, TOTAL, total(), theBuilder(), ctx))).toMatch(/isn't this builder's turn for src\/pricing\/total\.ts/);
  });
  test('another planned file than the one it holds is named as the plan spells it', async () => {
    expect(await reasonOf(writes(s, GREETING, 'export const x = 1;\n', theBuilder()))).toBe("it isn't this builder's turn for src/greeting/Greeting.tsx");
  });
  test.each(['notes.md', 'tests/total.test.ts', 'contracts/order.ts', 'plan/plan.json'])('%s is not its file (or is protected)', async (rel) => {
    expect(await reasonOf(writes(s, rel, 'x\n', theBuilder()))).toMatch(/isn't this builder's turn|frozen|protected/);
  });
  test('a file that is not in the plan is refused as that, before the turn is looked at (cheat 6)', async () => {
    expect(await reasonOf(writes(s, 'lib/stash.ts', 'export const stash: string[] = [];\n', theBuilder()))).toMatch(/not in the plan/);
  });
  test('with no lock the build cannot have started', async () => {
    expect(await reasonOf(writes(s, TOTAL, total(), theBuilder(), { ...s.ctx, lock: null }))).toMatch(/no lock/);
  });
});

describe('rule 4: the text must keep what the lock fixed', () => {
  const bent = async (text: string): Promise<string> => await reasonOf(built(text));
  test('swapped steps are named', async () => {
    const [one, two, three] = ['Take the first price given', 'Add the second price to it', 'Hand back the combined total'];
    expect(await bent(total({ steps: [two, one, three] }))).toMatch(/step 1 in total was changed or removed; step 2 in total was changed or removed/);
  });
  test('a changed signature is named, and the file', async () => {
    expect(await bent(total({ params: 'a: number, b: string' }))).toMatch(/^src\/pricing\/total\.ts wasn't written: .*export total's signature changed/);
  });
  test('a header with the promises trimmed out', async () => {
    expect(await bent(total({ header: '/** @seam pricing */' }))).toMatch(/the header was changed/);
  });
  test('a name a locked signature uses may not be declared again, and the owner can be asked', async () => {
    const text = total({ params: 'r: Response, a: number' });
    const ctx = { ...s.ctx, lock: lockOf(text) };
    expect(await reasonOf(writes(s, TOTAL, `${text}interface Response {}\n`, theBuilder(), ctx)))
      .toMatch(/'Response' is used by a locked signature, so a new declaration of it isn't allowed \(if the plan needs this, ask the owner for a plan change\)/);
  });
});

describe('rule 4: the house rules, in plain words', () => {
  const bent = async (options: Parameters<typeof total>[0]): Promise<string> => await reasonOf(built(total(options)));
  test('the any type', async () => expect(await bent({ body: ['const x: any = 1;', 'void x;'] })).toMatch(/the file uses the any type/));
  test('a silent catch, with the way out', async () => {
    expect(await bent({ body: ['try { void a; } catch { /* nothing */ }'] })).toMatch(/the file has a silent catch \(throw the error or use it\)/);
  });
  test('process.env outside src/config', async () => expect(await bent({ body: ['void process.env.HOME;'] })).toMatch(/reads process\.env outside src\/config/));
  test('too many lines', async () => expect(await reasonOf(built(long(200)))).toMatch(/is 2\d\d lines; the limit is 200/));
  test('fs, require and dynamic import', async () => {
    expect(await bent({ body: ["const fs = require('fs');", 'void fs;'] })).toMatch(/fs\/require\/dynamic import/);
  });
  test('a file that does not parse is said once, not twice', async () => {
    const reason = await reasonOf(built('export function total( {\n'));
    expect(reason.match(/doesn't parse/g)).toHaveLength(1);
  });
  test('several problems come back together, each once', async () => {
    const reason = await bent({ params: 'a: any, b: number' });
    expect(reason).toMatch(/signature changed/);
    expect(reason).toMatch(/uses the any type/);
  });
  test('a reason reads as a rule, not as the guard failing', async () => {
    expect(await bent({ params: 'a: number' })).not.toMatch(/blocked to be safe/i);
  });
});

describe('Review Focus 4: an edit that cannot be applied is refused in words', () => {
  test('an old_string that is not in the file', async () => {
    expect(await reasonOf(edits(s, TOTAL, 'this text is nowhere', 'x', theBuilder()))).toMatch(/the text to replace wasn't found in .*total\.ts/);
  });
  test('a planned file deleted from disk', async () => {
    const t = await scene();
    rmSync(t.app.abs(TOTAL));
    expect(await reasonOf(edits(t, TOTAL, 'a', 'b', theBuilder()))).toMatch(/total\.ts doesn't exist yet/);
  });
  test('a Write needs no file on disk', async () => {
    const t = await scene();
    rmSync(t.app.abs(TOTAL));
    await isAllowed(writes(t, TOTAL, total(), theBuilder()));
  });
  test('NotebookEdit is refused for code', async () => {
    const nb = ask(s, 'NotebookEdit', { notebook_path: s.app.abs(TOTAL), new_source: 'x' }, theBuilder());
    expect(await reasonOf(nb)).toMatch(/notebook/);
  });
});
