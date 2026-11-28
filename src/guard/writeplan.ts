// plan/plan.json is checked against the plan schema before the main AI writes it. A typo in it (a step list that is too
// short, a field with the wrong name) used to be written, and then the guard could not read the plan: the tamper check
// put it back and halted the run, for a mistake an honest planner makes. Refusing the write instead tells the planner
// what to fix, and nothing is lost.
import { PLAN_PATH, PlanSchema } from '../formats/plan.ts';
import { explain } from '../formats/read.ts';
import { describeError } from './output.ts';

/** What is wrong with `text` as the new plan.json, as a sentence that names the first problem, or null if it is a valid plan. */
export function planProblem(text: string): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    return `${PLAN_PATH} isn't valid yet: it is not valid JSON (${describeError(err)})`;
  }
  const result = PlanSchema.safeParse(raw);
  return result.success ? null : `${PLAN_PATH} isn't valid yet: ${explain(result.error).split('\n')[0].replace(/^\s*-\s*/, '')}`;
}
