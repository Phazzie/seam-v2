// state.json is not in the protected-file record: the guard writes it on every refusal, so it is checked against
// its own copy, `<dataDir>/mirror/<root key>/state.json`, which `writeState` keeps in step (the copy is written
// first, so after an interrupted write the copy is the newer one). The two files are not written at one instant,
// so a difference seen outside the lock may be a write in progress: look again inside it before acting.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_PATH } from '../formats/state.ts';
import { atomicWrite, errorCode } from '../lib/atomic.ts';
import { recordFolder } from './tamperrecord.ts';
import type { Home } from './tamperrecord.ts';

const textOrNull = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    throw err;
  }
};

const mirrorFile = (ctx: Home): string => join(recordFolder(ctx), 'state.json');

/** Is state.json not the same as its copy? False if there is no copy to compare it with. */
export function stateDiffers(ctx: Home): boolean {
  const copy = textOrNull(mirrorFile(ctx));
  return copy !== null && textOrNull(join(ctx.root, STATE_PATH)) !== copy;
}

/** Put state.json back from its copy; false if there is no copy. Call it under the lock, after `stateDiffers` was still true there. */
export function restoreState(ctx: Home): boolean {
  const copy = textOrNull(mirrorFile(ctx));
  if (copy !== null) atomicWrite(join(ctx.root, STATE_PATH), copy);
  return copy !== null;
}

/** Make the copy match state.json as it is now (for a snapshot, which takes the state as it stands). */
export function copyState(ctx: Home): void {
  const text = textOrNull(join(ctx.root, STATE_PATH));
  if (text !== null) atomicWrite(mirrorFile(ctx), text);
}
