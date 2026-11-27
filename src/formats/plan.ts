// The plan file: plan/plan.json. It says what will be built, file by file, with the
// steps and promises each file must keep. Frozen at approval; builders never see it whole.
import { z } from 'zod';
import { PROMISE_ID_PATTERN, SEAM_ID_PATTERN, headerTextProblem } from './header.ts';
import { loadJson, parseWith } from './read.ts';

export const PLAN_PATH = 'plan/plan.json';

/** A line of text that will be copied into a file header, so it must be safe there. */
const headerText = z.string().superRefine((text, ctx) => {
  const problem = headerTextProblem(text);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

export const FilePlanSchema = z.strictObject({
  path: z.string().min(1),
  kind: z.enum(['code', 'mock', 'adapter', 'screen', 'config']),
  purpose: headerText,
  inputs: headerText,
  outputs: headerText,
  imports: z.array(z.string()),
  exports: z.array(z.strictObject({ name: z.string().min(1), signature: z.string().min(1) })),
  steps: z.array(headerText).min(3, 'needs at least 3 steps, each one specific and checkable'),
  promises: z.array(
    z.strictObject({
      id: z.string().regex(PROMISE_ID_PATTERN, 'promise ids look like P-pricing-1 (P-, a name, a number)'),
      text: headerText,
    }),
  ),
  estLines: z.number().int().nonnegative(),
});
export type FilePlan = z.infer<typeof FilePlanSchema>;

export const SeamPlanSchema = z.strictObject({
  id: z.string().regex(SEAM_ID_PATTERN, 'seam ids use lowercase letters, numbers and dashes'),
  name: z.string().min(1),
  services: z.array(z.strictObject({ name: z.string(), address: z.string(), mutating: z.boolean() })),
  files: z.array(FilePlanSchema),
});
export type SeamPlan = z.infer<typeof SeamPlanSchema>;

export const PlanSchema = z.strictObject({
  version: z.literal(1),
  appRoot: z.string(),
  seams: z.array(SeamPlanSchema),
  buildOrder: z.array(z.string()),
  config: z.array(z.string()),
  generated: z.array(z.string()),
  packages: z.array(z.string()),
  legacyRoot: z.string().nullable(),
});
export type Plan = z.infer<typeof PlanSchema>;

/** Check plan data that is already parsed. Throws a plain-English error if it doesn't fit. */
export function parsePlan(raw: unknown, label = 'the plan'): Plan {
  return parseWith(PlanSchema, raw, label);
}

/** Read `<root>/plan/plan.json`. Null if absent; throws if present but unreadable or invalid. */
export function loadPlan(root: string): Plan | null {
  return loadJson(PlanSchema, root, PLAN_PATH);
}
