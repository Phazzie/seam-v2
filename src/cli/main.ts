// The `seam` command's subcommands: init, request, approve, report, install-shortcut, and the owner's edit and repair.
// The main AI may run report, status, request, init, install-shortcut and help (the guard's list); approve, edit and
// repair are the owner's, each refusing to run without a real keyboard, and approve and edit only from the shortcut's window.
import { join } from 'node:path';
import { readCliEnv } from '../config/cli.ts';
import { approve } from './approve.ts';
import { editFile } from './edit.ts';
import { dataDirForInit, loadCtx, whereAmI } from './home.ts';
import { initProject } from './init.ts';
import { renderReport } from './report.ts';
import { repair } from './repair.ts';
import { requestApproval } from './request.ts';
import { installShortcut, SCRIPT_NAME } from './shortcut.ts';
import { terminal } from './terminal.ts';

const HELP = [
  'seam <command>',
  '  report              where the project stands, in plain words (also: status)',
  '  request <kind>      ask the owner to approve a step: features, freeze, flips, cutover, reopen, park or edit',
  '  init                start a seam project in this folder (--app-root <dir>, --legacy <dir>)',
  '  install-shortcut    put "Seam Approve" on the desktop',
  'For the owner only (they refuse to run without a real keyboard, and approve and edit only from the Seam Approve window):',
  '  approve             approve what was asked for',
  '  edit <file>         accept your own change to a protected file',
  '  repair              put back a plan, lock or state file that cannot be read',
].join('\n');

/** The value after `flag`, or undefined. */
function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
}

/** Run one command. Returns the exit code. Errors the commands throw are plain sentences, and the caller prints them. */
export async function main(args: string[], env: NodeJS.ProcessEnv, cwd: string, ownPluginRoot: string): Promise<number> {
  const [sub = 'help', ...rest] = args;
  const cli = readCliEnv(env);
  const pluginRoot = cli.pluginRoot ?? ownPluginRoot;
  const out = (text: string): void => void process.stdout.write(`${text}\n`);
  const where = () => whereAmI(cwd, cli, pluginRoot);
  const owner = terminal(() => join(where().dataDir, SCRIPT_NAME));
  try {
    switch (sub.toLowerCase()) {
      case 'help':
      case '--help':
        out(HELP);
        return 0;
      case 'init':
        out(initProject({ cwd, dataDir: dataDirForInit(cli), pluginRoot, appRoot: flagValue(rest, '--app-root'), legacy: flagValue(rest, '--legacy') }));
        return 0;
      case 'report':
      case 'status':
        out(renderReport(loadCtx(where()), new Date()));
        return 0;
      case 'request':
        out(requestApproval(loadCtx(where()), rest[0] ?? ''));
        return 0;
      case 'approve':
        return await approve(owner.io, () => loadCtx(where()));
      case 'edit':
        return await editFile(owner.io, () => loadCtx(where()), rest[0], cwd);
      case 'repair':
        return await repair(owner.io, where());
      case 'install-shortcut': {
        const w = where();
        installShortcut({ root: w.root, dataDir: w.dataDir, pluginRoot: w.pluginRoot, desktopDir: cli.desktopDir });
        out('The "Seam Approve" shortcut is on your desktop. Double-click it when something is waiting for your approval.');
        return 0;
      }
      default:
        process.stderr.write(`seam: "${sub}" is not a seam command.\n${HELP}\n`);
        return 1;
    }
  } finally {
    owner.close();
  }
}
