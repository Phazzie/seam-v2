// dist/seam.mjs: runs the `seam` command (main.ts) for this process, and turns what it throws into plain lines.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentEnv } from '../config/env.ts';
import { REPAIR_HINT, repairable } from './hint.ts';
import { main } from './main.ts';

/** The plugin's own folder: dist/seam.mjs sits one folder down from it. */
const ownPluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

main(process.argv.slice(2), currentEnv(), process.cwd(), ownPluginRoot).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`seam: ${message}\n`);
    if (repairable(message)) process.stderr.write(`${REPAIR_HINT}\n`);
    process.exitCode = 1;
  },
);
