#!/usr/bin/env bash
# Runs ONE headless `claude -p` check from live-checks/scratch/ with a probe plugin loaded.
#
# usage (from anywhere):
#   PROBE_RUN=<label> [PROBE_MODE=...] [PROBE_OUT=...] [PROBE_VITEST_DIR=...] [PROBE_BLOCK_LIMIT=...] [RUN_TIMEOUT=300] \
#     live-checks/run.sh <plugin-dir> "<prompt>" [extra claude args...]
#
# Writes in live-checks/scratch/: out-<label>.txt (stdout), err-<label>.txt (stderr), meta-<label>.txt (exit code, seconds).
# The hooks write live-checks/out/hook-log.jsonl (git-ignored).
# Needs Git Bash (or any bash with `timeout`), node and the claude CLI. The CLAUDE_CODE_* identity vars of a
# parent Claude Code session are removed for the child; removing vars that are not set is harmless.
set -u
label="${PROBE_RUN:?set PROBE_RUN to a short label, for example ab}"
plugin_arg="${1:?first argument: plugin dir}"
prompt="${2:?second argument: the prompt}"
shift 2
here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(cd "$plugin_arg" && (pwd -W 2>/dev/null || pwd))"   # absolute, Windows form under Git Bash
cd "$here/scratch" || { echo "run live-checks/setup-scratch.sh first" >&2; exit 1; }
start=$(date +%s.%N)
env -u CLAUDECODE -u CLAUDE_CODE_AGENT -u CLAUDE_CODE_BRIDGE_SESSION_ID -u CLAUDE_CODE_CHILD_NOTES_DIR \
  -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS \
  -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ATTENDED \
  -u CLAUDE_CODE_SESSION_ID -u CLAUDE_JOB_DIR -u CLAUDE_PID -u CLAUDE_EFFORT \
  timeout "${RUN_TIMEOUT:-300}" claude -p --plugin-dir "$plugin" "$@" "$prompt" \
  > "out-$label.txt" 2> "err-$label.txt"
code=$?
end=$(date +%s.%N)
secs=$(node -e "console.log((($end-$start)).toFixed(1))")
echo "run=$label exit=$code seconds=$secs" | tee "meta-$label.txt"
