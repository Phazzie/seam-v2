// The guard's own time limit. Claude Code lets a tool call go ahead when a hook times out (live
// check d), so the guard cannot wait to be killed: it answers by itself, with a refusal, first.
// hooks.json gives the hook 30 seconds; the guard stops waiting at 20.

export const GUARD_TIMEOUT_MS = 20_000;

/**
 * Run `work` and give back its answer, or `onTimeout()` if it has not answered within `ms`. The
 * timer is stopped as soon as either happens, so it never keeps the process alive. `work` that is
 * still running at the deadline is left behind (the hook exits right after it answers).
 */
export async function raceDeadline<T>(work: () => Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  try {
    return await Promise.race([work(), late]);
  } finally {
    clearTimeout(timer);
  }
}
