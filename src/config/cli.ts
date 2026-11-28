// What the `seam` command takes from the machine it runs on (only src/config reads the environment). The command is
// run by the owner, in a terminal or from the Seam Approve shortcut, or by the main AI through a Bash call: none of those
// is a hook, so Claude Code does not hand it CLAUDE_PLUGIN_DATA the way it does a hook. `seam init` writes the data
// folder into `.seam/env.json`, and every later command reads it from there.

export interface CliEnv {
  /** SEAM_DATA_DIR: the data folder, said outright (a test, or an owner who set it). Beats everything else. */
  dataDir: string | null;
  /** CLAUDE_PLUGIN_DATA: the data folder, when Claude Code gave it to this process. */
  pluginData: string | null;
  /** CLAUDE_PLUGIN_ROOT: the plugin's own folder, when Claude Code gave it to this process. */
  pluginRoot: string | null;
  /** SEAM_DESKTOP_DIR: where `seam install-shortcut` puts the shortcut instead of the real desktop (a test). */
  desktopDir: string | null;
}

const text = (value: string | undefined): string | null => (value === undefined || value === '' ? null : value);

/** The variables the command reads. An empty one counts as not set. */
export function readCliEnv(env: NodeJS.ProcessEnv): CliEnv {
  return {
    dataDir: text(env.SEAM_DATA_DIR),
    pluginData: text(env.CLAUDE_PLUGIN_DATA),
    pluginRoot: text(env.CLAUDE_PLUGIN_ROOT),
    desktopDir: text(env.SEAM_DESKTOP_DIR),
  };
}
