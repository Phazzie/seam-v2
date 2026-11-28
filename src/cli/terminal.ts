// The owner's side of the real terminal: its keyboard and its screen. One readline interface serves every question of a
// command, and the lines come out of it one at a time, in order, so a line typed ahead is not lost. It is closed when the
// command ends. If the input ends before an answer comes (Ctrl+D, a closed window) the question fails, so the command stops
// with an error rather than leave without a word and look as if it had finished.
import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import { launchedByShortcut } from './shortcut.ts';
import type { OwnerIo } from './owner.ts';

export interface Terminal { io: OwnerIo; close: () => void }

/** `script` finds the installed seam-approve.cmd; it is called only when the shortcut is asked about. */
export function terminal(script: () => string): Terminal {
  let rl: Interface | undefined;
  let lines: AsyncIterator<string> | undefined;
  return {
    io: {
      stdinTty: process.stdin.isTTY === true,
      stdoutTty: process.stdout.isTTY === true,
      byShortcut: () => launchedByShortcut(script()),
      say: (text) => void process.stdout.write(`${text}\n`),
      ask: async (question) => {
        rl ??= createInterface({ input: process.stdin, output: process.stdout });
        lines ??= rl[Symbol.asyncIterator]();
        rl.setPrompt(question);
        rl.prompt();
        const next = await lines.next();
        if (next.done === true) throw new Error('The input ended before an answer was typed, so nothing was done.');
        return next.value;
      },
    },
    close: () => rl?.close(),
  };
}
