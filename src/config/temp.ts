// The one place outside the project where the main AI may write (R57): the system's temp folder. It is read here,
// with the rest of what the guard takes from the machine it runs on (only src/config reads the environment).
import { tmpdir } from 'node:os';

/** The temp folder, as the system names it (the guard makes it canonical before it compares). */
export function tempFolder(): string {
  return tmpdir();
}
