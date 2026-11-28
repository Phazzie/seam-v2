// dist/seam.mjs: runs the `seam` command (main.ts) for this process, and turns what it throws into plain lines.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentEnv } from '../config/env.ts';
import { main } from './main.ts';

/** The plugin's own folder: dist/seam.mjs sits one folder down from it. */
const ownPluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What the record readers say when a file of the project's own cannot be read ("... is unreadable: ...", "... is invalid: ..."). */
const DAMAGED = /\b(?:is unreadable|is invalid|is missing)\b/;

main(process.argv.slice(2), currentEnv(), process.cwd(), ownPluginRoot).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`seam: ${message}\n`);
    if (DAMAGED.test(message)) process.stderr.write('If a plan, lock or state file is damaged, the owner can put it back with seam repair in your own terminal.\n');
    process.exitCode = 1;
  },
);
