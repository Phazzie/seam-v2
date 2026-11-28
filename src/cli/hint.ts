// When an error says a file of the project's own is damaged, whether `seam repair` is the way out. It is for plan.json, lock.json and
// state.json (put back from the guard's record), and for the guard's own record of the protected files (which cannot be put back from
// itself, so repair sets a damaged one aside and the window's "accept my own edits" takes a fresh one). It is not for a request that
// cannot be read (the window clears it) or the setup file (the guard puts it back after the next tool call, and the commands cannot
// even find the data folder to repair from without it): a hint that sends the owner there is worse than none.

/** What the loaders say first, for the files repair deals with (their own words: "<file> is unreadable: ...", "... is invalid: ...", "... is missing, ..."). */
const REPAIRABLE = /^(?:plan\/plan\.json|\.seam\/(?:lock|state)\.json) (?:is unreadable|is invalid|is missing)\b|^The guard's record of the protected files\b/;

/** Is this error one `seam repair` can deal with? */
export const repairable = (message: string): boolean => REPAIRABLE.test(message.trim());

/** What is said after such an error. */
export const REPAIR_HINT = "If a plan, lock or state file (or the guard's record of the protected files) is damaged, the owner can put it right with seam repair in your own terminal.";
