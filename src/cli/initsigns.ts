// What is left of a project whose `.seam/state.json` is gone (R82). `seam init` starts a project where there is no state.json, but
// a folder whose state.json was deleted is not new: starting it again would write a fresh state and a fresh record of the protected
// files over the guard's saved ones, wiping its approvals, progress and halts, and accepting any unapproved change to a protected file as it
// stands. So init looks for the other signs of a project first: `.seam/env.json`, the project's line in the list kept in the data folder,
// and the guard's saved state and saved record of the protected files there.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { recordFolder } from '../guard/tamperrecord.ts';
import { ENV_PATH } from '../formats/env.ts';
import { isListed, REGISTRY_FILE } from '../lib/registry.ts';

/** The words for each sign of the project that is still there, in plain order. Empty for a folder that is new. */
export function signsOfProject(root: string, dataDir: string): string[] {
  const saved = recordFolder({ root, dataDir });
  const signs: Array<[boolean, string]> = [
    [existsSync(join(root, ENV_PATH)), ENV_PATH],
    [isListed(root, dataDir), `its line in the project list (${join(dataDir, REGISTRY_FILE)})`],
    [existsSync(join(saved, 'state.json')), "the guard's saved copy of its state"],
    [existsSync(join(saved, 'protected.json')), "the guard's saved record of its protected files"],
  ];
  return signs.filter(([there]) => there).map(([, words]) => words);
}

/** The refusal for a folder that has signs of a project but no state.json, or null if it has none. */
export function lostStateRefusal(root: string, dataDir: string): string | null {
  const signs = signsOfProject(root, dataDir);
  if (signs.length === 0) return null;
  const findable = existsSync(join(root, ENV_PATH)) ? '' : ` seam repair needs ${ENV_PATH} to find the project, and that is gone too: put it back from git or a backup first.`;
  return (
    `${root} is a seam project whose state file (.seam/state.json) is gone, but ${signs.join(', ')} ${signs.length === 1 ? 'is' : 'are'} still there, ` +
    'so it is not started again: that would wipe its approvals, progress and halts, and accept any unapproved change to the protected files as it stands. ' +
    "Ask the owner to run seam repair (in their own terminal or the Seam Approve window), which puts the state file back from the guard's saved copy if there is one." +
    `${findable} (To start this folder over on purpose, delete its records folder ${recordFolder({ root, dataDir })} and its line in ${join(dataDir, REGISTRY_FILE)} by hand, then run seam init.)`
  );
}
