// The guard's time limits. Claude Code lets a tool call go ahead when a hook times out or is killed
// (live check d), so the guard has to answer by itself, with a refusal, well inside the 30 seconds
// hooks.json gives it.

/** How long the guard works on one request before it refuses for taking too long. */
export const GUARD_TIMEOUT_MS = 20_000;

/** How long the guard waits for a refusal it could not record to be recorded, after the limit. */
export const RECORD_TIMEOUT_MS = 3000;
