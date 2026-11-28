// Shared by the approval tests: an app in a phase with its record taken and a skeleton for every planned file, and the
// ways to ask for an approval the way the main AI does, and to read what was asked.
import { loadPending } from '../../src/cli/pending.ts';
import { requestApproval } from '../../src/cli/request.ts';
import { loadState } from '../../src/formats/state.ts';
import type { Phase } from '../../src/types.ts';
import { makeApp } from './app.ts';
import type { App } from './app.ts';
import { TOTAL, planFile, skeleton } from './code.ts';
import { ctxOf } from './tamper.ts';

export const PENDING = '.seam/pending.json';
export const GREETING = 'src/greeting/Greeting.tsx';
export const THE_WINDOW = 'approvals happen in the Seam Approve window on your desktop';
export const STALE = 'things changed since this was requested; ask for a fresh approval';

export const skeletons = (): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const path of [TOTAL, GREETING]) {
    const { seam, file } = planFile(path);
    files[path] = skeleton(seam, file);
  }
  return files;
};

/** An app in `phase` with a record of its protected files, and (so the plan can be frozen) a skeleton for every planned file. */
export const appIn = (phase: Phase): Promise<App> => makeApp({ phase, snapshot: true, files: skeletons() });
export const stateOf = (app: App) => loadState(app.root)!;
export const codeOf = (app: App): string => loadPending(app.root)!.code;

/** Ask for an approval the way the main AI does (`seam request <kind>`), and give back the code the owner would see in the window. */
export function requested(app: App, kind: string): string {
  requestApproval(ctxOf(app), kind);
  return codeOf(app);
}

/** A request for a kind that does not fit the phase, which `seam request` itself refuses: written by hand, to test what approving does with it. */
export function plantedRequest(app: App, kind: string): string {
  const code = requested(app, 'park');
  app.writeRaw(PENDING, JSON.stringify({ ...loadPending(app.root)!, kind }));
  return code;
}
