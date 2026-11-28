// A fresh code to type back, three tries: what the owner does to agree to something that takes more than they asked about (a fresh
// record of every protected file, say). The window's menu and `seam edit` both ask it this way.
import { TRIES } from './approve.ts';
import type { OwnerIo } from './owner.ts';
import { newCode } from './pending.ts';

/** Show a fresh code and ask for it (a space around it and the letter case do not matter). True if it was typed; after three wrong tries, says so and answers false. */
export async function typedTheCode(io: OwnerIo): Promise<boolean> {
  const code = newCode();
  io.say(`Code: ${code}`);
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    if ((await io.ask(`Type the code above to confirm (try ${attempt} of ${TRIES}): `)).trim().toUpperCase() === code) return true;
    io.say('That is not the code.');
  }
  io.say('Three wrong tries, so nothing was accepted.');
  return false;
}
