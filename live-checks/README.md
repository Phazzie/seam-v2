# live-checks

How the stage 1 live checks were run. Results and what they mean: [docs/live-checks.md](../docs/live-checks.md).

What is here:

- `probe-plugin/`: the throwaway plugin `seam-probe`. Its hook `log-hook.mjs` appends one JSON line per hook call to
  `live-checks/out/hook-log.jsonl`. Env vars choose the behavior (below).
- `setup-scratch.sh`: builds the git-ignored `live-checks/scratch/` the checks run in (a `README.md` to read, a stub MCP
  server and its config, a one-test vitest project, and a copy of the probe plugin with `"timeout": 5`).
- `run.sh`: runs one headless `claude -p` check from `scratch/`.
- `out/` and `scratch/` are git-ignored. They hold local paths and raw logs: do not commit them.

Needs: Git Bash (the scripts use `pwd -W` and `timeout`), Node, the `claude` CLI on PATH, network for the one `npm install`.
Measured with Claude Code 2.1.332 on Windows 11. Each run costs a few cents on `--model haiku`.

## Env vars of `probe-plugin/log-hook.mjs`

| Variable | Effect |
|---|---|
| `PROBE_RUN` | label copied into every log line (`run.sh` requires it) |
| `PROBE_MODE=crash` | throw after logging (exit code 1) |
| `PROBE_MODE=sleep` | sleep 120 s after logging |
| `PROBE_MODE=deny-read` | `PreToolUse` denies `Read` when `agent_type` contains `builder` |
| `PROBE_MODE=block-stop` | `SubagentStop` prints `{"decision":"block",...}`, up to `PROBE_BLOCK_LIMIT` times per agent (default 20) |
| `PROBE_MODE=block-stop-exit2` | `SubagentStop` writes the reason to stderr and exits 2 |
| `PROBE_MODE=vitest` | on every `PreToolUse`, time `npx vitest run` in `PROBE_VITEST_DIR` (an absolute path) |
| `PROBE_OUT` | log file path. Default is `../out/hook-log.jsonl` relative to the plugin folder, so it only works when the plugin runs from `live-checks/`. A copy elsewhere (the scratch copy in check d) or a marketplace install needs `PROBE_OUT` set. |

`hooks.json` registers `PreToolUse` and `PostToolUse` (matcher `.*`), `SubagentStart` and `SubagentStop`, each running
`node ${CLAUDE_PLUGIN_ROOT}/log-hook.mjs`, with no explicit timeout. The probe does not test an explicit `PowerShell`
matcher; `.*` was enough to log PowerShell tool calls.

## Setup, once

From the repo root, in Git Bash:

```bash
live-checks/setup-scratch.sh
P=live-checks/probe-plugin
OUT="$(cd live-checks/out && pwd -W)/hook-log.jsonl"          # absolute log path (check d needs it)
VT="$(cd live-checks/scratch/vitest-app && pwd -W)"           # absolute vitest project path (check j needs it)
```

`--model haiku --output-format json --debug-file debug-<label>.log` are on every run below. The debug file lands in
`live-checks/scratch/`. Output of a run: `scratch/out-<label>.txt` (the JSON result), `err-<label>.txt`, `meta-<label>.txt`.

## The checks

Each block is the exact command line that was run (prompts verbatim).

**a, b, l** (one run; label `ab`). Look at `SubagentStart` and the builder's `PreToolUse` `Read` lines in the log (a, b),
and `CLAUDE_PLUGIN_DATA` in any line (l):

```bash
PROBE_RUN=ab live-checks/run.sh $P "Use the seam-probe:builder agent to read README.md" \
  --model haiku --max-turns 8 --output-format json --debug-file debug-ab.log
```

**c** hook crash. Check whether `scratch/crash-test.txt` exists afterwards and look for `status code 1` in the debug file:

```bash
rm -f live-checks/scratch/crash-test.txt
PROBE_MODE=crash PROBE_RUN=c live-checks/run.sh $P \
  "Create a file named crash-test.txt in the current folder containing the single word hello. Then tell me whether the file was created and quote any hook or tool message you saw word for word." \
  --model haiku --max-turns 8 --permission-mode acceptEdits --output-format json --debug-file debug-c.log
```

**d** hook timeout. Uses the scratch copy of the plugin with `"timeout": 5`. `PROBE_OUT` is required here: the copy is not
inside `live-checks/`, so without it the log would go to the wrong folder:

```bash
rm -f live-checks/scratch/timeout-test.txt
PROBE_OUT="$OUT" PROBE_MODE=sleep PROBE_RUN=d live-checks/run.sh live-checks/scratch/probe-plugin-d \
  "Create a file named timeout-test.txt in the current folder containing the single word hello. Then tell me whether the file was created and quote any hook or tool message you saw word for word." \
  --model haiku --max-turns 8 --permission-mode acceptEdits --output-format json --debug-file debug-d.log
```

Look for `timed out after 5000ms` in the debug file. There must be no `sleep-end` line in the log, even 120 s later.

**e** Agent tool input (`tool_name` and `tool_input.prompt` of the `PreToolUse` line for `Agent`):

```bash
PROBE_RUN=e live-checks/run.sh $P "start the seam-probe:builder agent with the prompt TOKEN-123" \
  --model haiku --max-turns 8 --output-format json --debug-file debug-e.log
```

**f** MCP tool names. `--mcp-config` adds the stub server `seam-probe-mcp`. The GrabGPU part uses the claude.ai connector of the
signed-in account; if you do not have it, drop that half of the prompt:

```bash
PROBE_RUN=f live-checks/run.sh $P \
  "Call the ping tool from the seam-probe-mcp MCP server once (use ToolSearch to load it first if it is deferred), and also call the find_gpu tool from the GrabGPU connector once if you have it. Report each tool name exactly as you called it, and each result." \
  --model haiku --max-turns 10 --mcp-config mcp-config.json --output-format json --debug-file debug-f.log
```

**g** no terminal for commands (the `PostToolUse` `tool_response.stdout` of the `Bash` and `PowerShell` lines):

```bash
PROBE_RUN=g live-checks/run.sh $P \
  'Run this exact command with the Bash tool: node -e "console.log(process.stdin.isTTY, process.stdout.isTTY)"   Then run the same node command with the PowerShell tool (if you have no PowerShell tool, say so). Report the exact output of each, word for word.' \
  --model haiku --max-turns 8 --output-format json --debug-file debug-g.log
```

**h** builder edit prompts: not run (needs an interactive session). To do it: start `claude --plugin-dir live-checks/probe-plugin`
in default permission mode in a scratch folder, ask for the `seam-probe:builder` agent to write a file, and note whether a
permission prompt appears for the builder's `Write`.

**i** deny for one agent type. The builder's own tool result is in its transcript
(`~/.claude/projects/<project>/<session id>/subagents/agent-<id>.jsonl`):

```bash
PROBE_MODE=deny-read PROBE_RUN=i live-checks/run.sh $P \
  "Use the seam-probe:builder agent to read README.md. Tell me exactly what the agent reported, including any error text word for word." \
  --model haiku --max-turns 8 --output-format json --debug-file debug-i.log
```

**j** hook time budget. First run (cold: no `node_modules/.vite` yet, right after setup), then three standalone timings:

```bash
PROBE_MODE=vitest PROBE_VITEST_DIR="$VT" PROBE_RUN=j live-checks/run.sh $P "Read README.md and tell me its first line." \
  --model haiku --max-turns 6 --output-format json --debug-file debug-j.log
# the `vitest` line of the log has the seconds; the debug file has the hook total ("finished with status 0 (...ms)")
cd live-checks/scratch/vitest-app && rm -rf node_modules/.vite
for n in 1 2 3; do s=$(date +%s.%N); npx vitest run >/dev/null 2>&1; e=$(date +%s.%N); node -e "console.log($e-$s)"; done
```

**k** forced continues (`SubagentStop` blocks every time). Counts: `SubagentStop` lines per run in the log, and the
`Stop hook block discarded` line in the debug file. `--max-budget-usd` is a safety cap in case blocking ever does loop:

```bash
PROBE_MODE=block-stop PROBE_BLOCK_LIMIT=20 PROBE_RUN=k live-checks/run.sh $P \
  "Use the seam-probe:builder agent to read README.md and report what it says." \
  --model haiku --max-turns 40 --max-budget-usd 0.60 --output-format json --debug-file debug-k.log
```

**k2** same, but the hook blocks with exit code 2 and the reason on stderr. The model chose to launch the agent async in the run
documented (see docs/live-checks.md), which is not under our control:

```bash
PROBE_MODE=block-stop-exit2 PROBE_RUN=k2 live-checks/run.sh $P \
  "Use the seam-probe:builder agent to read README.md and report what it says." \
  --model haiku --max-turns 40 --max-budget-usd 0.60 --output-format json --debug-file debug-k2.log
```

## Reading a run

```bash
node -e 'const fs=require("fs");for(const l of fs.readFileSync("live-checks/out/hook-log.jsonl","utf8").trim().split("\n")){const e=JSON.parse(l);if(e.run!==process.argv[1])continue;const i=e.input||{};console.log(e.ts.slice(11,23),e.phase,i.hook_event_name||e.event,i.tool_name||"",i.agent_id||"",i.agent_type||"")}' ab
```
