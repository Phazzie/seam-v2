// What a tamper costs, and who pays (6.6, 15.16). Called under the lock, once per check:
//  - another call was under way, so nobody can be blamed: the change is logged "unattributed", and only the third in
//    a row halts the run;
//  - a builder: a strike on the file it was building;
//  - the main AI (or any other agent): the run is halted, for the owner to look at.
import { readState, writeState } from '../lib/store.ts';
import { logLine } from '../lib/log.ts';
import { roleOf } from '../lib/roles.ts';
import type { Ctx, HookInput } from '../types.ts';
import type { TamperRecord } from './tamperrecord.ts';

/** This many changes in a row that could not be tied to a call halt the run. */
const UNATTRIBUTED_LIMIT = 3;

/** Who it was, for the halt text: "the main AI", "the checker agent". */
function who(input: HookInput): string {
  const role = roleOf(input);
  return role === 'main' ? 'the main AI' : `the ${role} agent`;
}

/** Record what the changes at `paths` cost. Changes `rec.unattributed`; the caller saves the record. */
export function consequences(ctx: Ctx, input: HookInput, rec: TamperRecord, paths: string[], others: number): void {
  if (paths.length === 0) return;
  const state = readState(ctx.root);
  const first = paths[0];
  let { halted } = state;
  const strikes = { ...state.strikes };
  if (others > 0) {
    rec.unattributed += 1;
    logLine(ctx.root, `Unattributed: ${paths.join(', ')} changed while ${others} other call${others === 1 ? ' was' : 's were'} running, so it was put back and nobody was blamed (${rec.unattributed} in a row).`);
    if (rec.unattributed >= UNATTRIBUTED_LIMIT) halted ??= `protected files changed ${UNATTRIBUTED_LIMIT} times in a row and the guard could not tell who changed them: ${first}`;
  } else if (roleOf(input) === 'builder') {
    rec.unattributed = 0;
    const turn = state.turn.file ?? first;
    strikes[turn] = (strikes[turn] ?? 0) + 1;
    logLine(ctx.root, `Strike ${strikes[turn]} for ${turn}: the builder changed ${paths.join(', ')} outside the rules.`);
  } else {
    rec.unattributed = 0;
    halted ??= `${who(input)} changed a protected file: ${first}`;
  }
  if (halted !== state.halted) logLine(ctx.root, `Halted: ${halted}`);
  writeState(ctx.root, ctx.dataDir, { ...state, strikes, halted });
}
