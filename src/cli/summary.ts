// What the owner is shown before approving, in plain words (stage 1: the phase, the counts and the fingerprinted files;
// stage 2 adds the full freeze page). It is written when the request is made and kept in `.seam/pending.json`, so what
// the owner reads in the window is exactly what was asked for. The code is not part of it: the window shows that apart.
import type { Ctx } from '../types.ts';
import { KIND_WORDS } from './moves.ts';
import type { Kind } from './moves.ts';
import { PHASE_WORDS } from './phases.ts';

/** How many fingerprinted files are named before "and N more". */
const SHOWN = 15;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * An edit has nothing fixed to show when it is asked for: the owner makes the changes afterwards. The window lists the files that
 * differ when it opens (approve.ts), and says to approve before Claude runs anything else, since the guard puts back a protected
 * file it did not expect to change when Claude's next step ends.
 */
const EDIT_NOTE = [
  'Make your changes to the protected files first.',
  'When you open the window it lists the files that differ from what the guard has, and approving takes them exactly as they are then.',
  "Do it before Claude runs anything else: when Claude's next step ends, the guard puts back any protected file it did not expect to change.",
];

/** The page for a request of `kind`, given the fingerprints that go with it. */
export function summaryOf(ctx: Ctx, kind: Kind, fingerprints: Record<string, string>): string {
  const lines = [`Approval: ${kind}`, `If you approve, Seam will ${KIND_WORDS[kind]}.`, `The project is in the ${ctx.state.phase} phase: ${PHASE_WORDS[ctx.state.phase]}.`];
  if (ctx.plan !== null) {
    const files = ctx.plan.seams.reduce((n, seam) => n + seam.files.length, 0);
    lines.push(`The plan has ${plural(ctx.plan.seams.length, 'seam')} and ${plural(files, 'file')}.`);
  } else {
    lines.push('There is no plan yet.');
  }
  if (kind === 'edit') return [...lines, ...EDIT_NOTE].join('\n');
  if (kind === 'park') lines.push(ctx.state.parked.length === 0 ? 'No files are parked.' : `Parked files: ${ctx.state.parked.join(', ')}.`);
  const named = Object.keys(fingerprints);
  if (named.length > 0) {
    lines.push(`Fingerprinted exactly as they are now (${plural(named.length, 'file')}). If any of them changes before you approve, this request goes stale and has to be asked for again:`);
    lines.push(...named.slice(0, SHOWN).map((path) => `  ${path}`));
    if (named.length > SHOWN) lines.push(`  and ${named.length - SHOWN} more`);
  }
  return lines.join('\n');
}
