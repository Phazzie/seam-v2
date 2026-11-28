// What separates the owner from the AI: a real keyboard, and (for approving) the Seam Approve window. The AI's commands
// run with their input and output piped, never at a terminal, and the guard refuses the commands that need the owner.
// The checks live here so approve, edit and repair ask them the same way. Nothing here reads a setting or an
// environment variable: a switch that let a script skip them would be a way round them.

/** The owner's side of a command: what the window is, and how to talk to the person at it. */
export interface OwnerIo {
  stdinTty: boolean;
  stdoutTty: boolean;
  /** Was this window opened from the Seam Approve shortcut? (Asked only when there is a keyboard: the check starts PowerShell.) */
  byShortcut: () => boolean;
  say: (text: string) => void;
  /** Show `question` and wait for one line. */
  ask: (question: string) => Promise<string>;
}

/** What `seam approve` says, word for word, when it is not in the window. */
export const THE_WINDOW = 'approvals happen in the Seam Approve window on your desktop';

/** Said after the refusal, so whoever reads it knows where the approval window comes from. */
const WHERE_FROM = 'The approval window is the one the Seam Approve shortcut opens; seam install-shortcut makes it.';

/** Has this command got a real keyboard and screen? If not, say `refusal` and answer true. */
export function refusedWithoutKeyboard(io: OwnerIo, refusal: string): boolean {
  if (io.stdinTty && io.stdoutTty) return false;
  io.say(refusal);
  return true;
}

/** Is this the approval window (a keyboard, and opened from the shortcut)? If not, say `refusal` and answer true. */
export function refusedOutsideWindow(io: OwnerIo, refusal: string): boolean {
  if (io.stdinTty && io.stdoutTty && io.byShortcut()) return false;
  io.say(`${refusal}. ${WHERE_FROM}`);
  return true;
}
