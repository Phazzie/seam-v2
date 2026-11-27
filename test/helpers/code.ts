// Code samples for the cheat tests: the approved total with its header, its skeleton, and
// the bent versions a cheating builder might try. Everything is built from the practice
// plan, so a header here always says exactly what the plan says.
import { resolve } from 'node:path';
import { formatHeader } from '../../src/formats/header.ts';
import { loadPlan } from '../../src/formats/plan.ts';
import type { FilePlan } from '../../src/formats/plan.ts';

export const FIXTURE = resolve(import.meta.dirname, '../fixtures/practice-app');
export const TOTAL = 'src/pricing/total.ts';

/** The practice plan's file entry for `path`, with the id of the seam it belongs to. */
export function planFile(path: string): { seam: string; file: FilePlan } {
  const plan = loadPlan(FIXTURE);
  for (const seam of plan?.seams ?? []) {
    const file = seam.files.find((f) => f.path === path);
    if (file) return { seam: seam.id, file };
  }
  throw new Error(`The practice plan has no file ${path}.`);
}

/** What the skeleton script writes: the header, the signature, the step markers, a throw. */
export function skeleton(seam: string, file: FilePlan): string {
  return [
    formatHeader(seam, file),
    '',
    `export function ${file.exports[0].signature} {`,
    ...file.steps.map((step, i) => `  // Step ${i + 1}: ${step}`),
    "  throw new Error('Not built yet');",
    '}',
    '',
  ].join('\n');
}

export interface TotalOptions {
  /** Replaces the whole header comment. */
  header?: string;
  /** Replaces the three step texts in the markers. */
  steps?: string[];
  /** Replaces the parameter list, which changes the signature. */
  params?: string;
  /** Lines placed above the function (imports). */
  top?: string[];
  /** Extra lines placed inside the function body. */
  body?: string[];
}

/** The approved total: its planned header, the real body, the three step markers in place. */
export function total(o: TotalOptions = {}): string {
  const { seam, file } = planFile(TOTAL);
  const steps = o.steps ?? file.steps;
  return [
    o.header ?? formatHeader(seam, file),
    ...(o.top ?? []),
    '',
    `export function total(${o.params ?? 'a: number, b: number'}): number {`,
    `  // Step 1: ${steps[0]}`,
    '  const first = a;',
    `  // Step 2: ${steps[1]}`,
    '  const sum = first + b;',
    ...(o.body ?? []).map((line) => `  ${line}`),
    `  // Step 3: ${steps[2]}`,
    '  return sum;',
    '}',
    '',
  ].join('\n');
}
