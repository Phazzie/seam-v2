// The guard's own time limit (see config/limits.ts) and a way to hold work to it.
export { GUARD_TIMEOUT_MS } from '../config/limits.ts';

/**
 * Run `work` and give back its answer, or `onTimeout()` if it has not answered within `ms`. The
 * timer is stopped as soon as either happens, so it never keeps the process alive. `work` that is
 * still running at the deadline is left behind (the hook exits right after it answers). This
 * cannot cut off work that never gives the thread back; the hook runs its decisions in a worker
 * thread for that (see supervisor.ts).
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
