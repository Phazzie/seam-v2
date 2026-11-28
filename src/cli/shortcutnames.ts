// What the approval launcher and its desktop shortcut are called (R81). They were one file and one shortcut for the whole data folder, so a
// second project sharing it overwrote the first one's. Each project now has its own: seam-approve-<rootKey>.cmd in the data folder, and a
// shortcut named for the project's folder, with a short key added if two projects have the same folder name.
import { join, win32 } from 'node:path';
import { rootKey } from '../lib/store.ts';

/** The launcher and the shortcut of the first version, one for every project: replaced when they are this project's, left when they are another's. */
export const OLD_SCRIPT_NAME = 'seam-approve.cmd';
export const OLD_SHORTCUT_NAME = 'Seam Approve';

/** This project's launcher: `seam-approve-<rootKey>.cmd`, the same for every spelling of its folder. */
export const scriptNameFor = (root: string): string => `seam-approve-${rootKey(root)}.cmd`;
export const scriptPathFor = (dataDir: string, root: string): string => join(dataDir, scriptNameFor(root));

/** This project's shortcut, without `.lnk`: "Seam Approve - <folder name>" (a drive's root has no folder name, so it is "project"). */
export const shortcutNameFor = (root: string): string => `${OLD_SHORTCUT_NAME} - ${win32.basename(root) || 'project'}`;
/** The name for it when another project has taken the plain one: the key makes it this project's alone. */
export const crowdedNameFor = (root: string): string => `${shortcutNameFor(root)} (${rootKey(root).slice(0, 6)})`;
