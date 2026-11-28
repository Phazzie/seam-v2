// What each kind of approval means, and how it moves the project (stage 1: the features approval and the freeze move the
// phase; park and edit let a halted run carry on; the others are recorded, and their moves arrive with their stages).
import { ApprovalRecordSchema } from '../formats/state.ts';
import type { ApprovalRecord } from '../formats/state.ts';
import type { Phase } from '../types.ts';

export type Kind = ApprovalRecord['kind'];
export const KINDS: readonly Kind[] = ApprovalRecordSchema.shape.kind.options;

export const isKind = (word: string): word is Kind => (KINDS as readonly string[]).includes(word);

/** What the owner is agreeing to, as a phrase that follows "Seam will" or "your approval to". */
export const KIND_WORDS: Record<Kind, string> = {
  features: 'accept the list of what the app will do and move on to planning it',
  freeze: 'lock the plan, the tests and the planned files, and let the builders start',
  flips: 'switch the pretend services over to the real ones',
  cutover: 'cut over from the old app to the new one',
  reopen: 'reopen a part of the plan for changes',
  park: 'park the files that are stuck and let the run carry on',
  edit: 'accept your own changes and let the run carry on',
};

export type Move = { ok: true; next: Phase } | { ok: false; why: string };

const stay = (phase: Phase): Move => ({ ok: true, next: phase });

/** Where an approval of `kind` takes a project that is in `phase`, or why it cannot be approved there. */
export function moveFor(kind: Kind, phase: Phase): Move {
  if (kind === 'features') {
    if (phase === 'setup' || phase === 'survey') return { ok: true, next: 'plan1' };
    return { ok: false, why: `the features can only be approved in the setup or survey phase (this project is in the ${phase} phase)` };
  }
  if (kind === 'freeze') {
    if (phase === 'tests') return { ok: true, next: 'build' };
    return { ok: false, why: `a freeze can only be approved in the tests phase (this project is in the ${phase} phase)` };
  }
  return stay(phase);
}
