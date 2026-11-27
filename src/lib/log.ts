// The plain log, `.seam/log.md`: one line per thing that happened, `HH:MM <text>`, in local time,
// so the owner can read it top to bottom. Lines are appended with `\n` endings.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { retryBusy } from './atomic.ts';
import { requireSeamDir } from './seamdir.ts';

export const LOG_PATH = '.seam/log.md';

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * Append one line. Line breaks inside `text` become single spaces so an entry never spills onto a
 * second line. Throws a plain error if `.seam/` is missing (the guard turns that into a refusal).
 */
export function logLine(root: string, text: string, now: Date = new Date()): void {
  requireSeamDir(root, 'nothing can be logged');
  const oneLine = text.replace(/\s*[\r\n]+\s*/g, ' ');
  const line = `${two(now.getHours())}:${two(now.getMinutes())} ${oneLine}\n`;
  retryBusy(`add to ${LOG_PATH}`, () => appendFileSync(join(root, LOG_PATH), line));
}
