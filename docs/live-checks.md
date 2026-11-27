# Live checks of Claude Code hook behavior

Task 1 of stage 1. The design depends on how Claude Code really treats hooks, and the docs are
silent on several points, so these were measured in a real Claude Code session instead of assumed.

- **Date:** 2026-11-27
- **Claude Code:** 2.1.332, Windows 11, Node v24.20.0
- **Method:** `claude -p --plugin-dir live-checks/probe-plugin` works, so no local marketplace was
  needed. Each check was one short headless run from `live-checks/scratch/` (git-ignored) with
  `--model haiku --max-turns <n> --output-format json --debug-file <file>`. The runs were launched
  from inside another Claude Code session, so the `CLAUDE_CODE_*` identity env vars of that parent
  session were unset for the child (`env -u ...`).
- **Permissions:** nothing was bypassed. The default mode came from the owner's own settings
  (`permission_mode: "auto"` in every hook input). Checks c and d passed `--permission-mode acceptEdits`
  so a file write could go through. No allow rules, no bypass flags.
- **Probe plugin:** `live-checks/probe-plugin` (name `seam-probe`). Its hook `log-hook.mjs` appends the raw stdin
  JSON, `CLAUDE_PLUGIN_DATA` and a run label to `live-checks/out/hook-log.jsonl` (git-ignored).
  Env vars pick the behavior: `PROBE_MODE=crash | sleep | deny-read | block-stop | block-stop-exit2 | vitest`
  (the last three are additions for checks j and k), `PROBE_RUN` (label), `PROBE_OUT` (log path override).
  `hooks.json` has no explicit timeout; check d ran from a throwaway copy of the plugin with `"timeout": 5`
  on every hook (in `live-checks/scratch/`).
- **Cost:** ten haiku runs, about 9 US cents in total.
- Paths below are shortened: `<repo>` is the seam-v2 checkout, `<home>` is the user's home folder.

## Gate summary

**DIFFERS (1):**

1. **Check k: DIFFERS.** `SubagentStop` returning `decision:block` does **not** force the builder to continue.
   Observed cap: **0 forced continues**, not 8. Claude Code reads the block, then throws it away
   (`Stop hook block discarded (turn ended by tool result, no model re-invoke)`) and the subagent finishes anyway.
   Exit code 2 with the reason on stderr is discarded the same way. Details under check k.

**Gate step 4 (fail-closed):** checks c and d both show that a crashing or timed-out hook **allows** the tool call.
The fail-closed guard therefore depends on never crashing past its own try/catch and its own timer. Task 7
covers that. Noted, continuing.

**Core of the design is intact:** hooks see subagent tool calls with `agent_id` and `agent_type` (b), and a
`permissionDecision: "deny"` really blocks the call for one agent type and the builder sees the reason (i).

**PENDING-OWNER (1):** check h needs an interactive session.

## Results

| # | Check | How it was run | Observed (exact) | Result |
|---|---|---|---|---|
| a | agent type name | `Use the seam-probe:builder agent to read README.md`, hooks logged | `SubagentStart` and every later hook call from inside the subagent carry `"agent_type":"seam-probe:builder"` (plugin name, colon, agent name; plugin loaded with `--plugin-dir`) | as expected |
| b | subagent reads hooked | same run as a | `PreToolUse` for `Read` carries `"agent_id":"a21b07d77aea12f63"` and `"agent_type":"seam-probe:builder"`. The matching `PostToolUse` carries both too. Hook calls from the main session carry neither field. | as expected |
| c | hook crash | `PROBE_MODE=crash` (uncaught throw, exit code 1), `acceptEdits`, `Create a file named crash-test.txt ... containing hello` | **ALLOWED.** `PreToolUse:Write` hook "finished with status 1", the Write ran, `crash-test.txt` exists and contains `hello`. The failure is only in the debug log (`[ERROR] Hook PreToolUse:Write (PreToolUse) error: status code 1` plus the stack trace). The `-p` stdout, stderr and the model's answer show nothing. | as expected (recorded: allows) |
| d | hook timeout | `PROBE_MODE=sleep`, `"timeout": 5` on every hook, `acceptEdits`, `Create a file named timeout-test.txt ... containing hello` | **ALLOWED.** Debug log: `PreToolUse:Write ... timed out after 5000ms (5390ms)`, then the Write ran (file written about 5 s after the hook started) and `timeout-test.txt` contains `hello`. The model never mentioned it, `-p` stderr was empty. The sleeping process was killed: none of the four `sleep-end` lines ever appeared, although the log was checked more than 120 s later. | as expected (recorded: allows) |
| e | Agent tool input | `start the seam-probe:builder agent with the prompt TOKEN-123` | `PreToolUse` `tool_name` is **`Agent`** (not `Task`). `tool_input` is `{"description":"Run seam-probe builder with token","prompt":"TOKEN-123","subagent_type":"seam-probe:builder","run_in_background":false}`. `tool_input.prompt` is exactly `TOKEN-123`. `run_in_background` was absent in one other run. | as expected |
| f | MCP/other tool names | prompt asked for the `ping` tool of a throwaway local MCP server named `seam-probe-mcp` (`--mcp-config`), plus `find_gpu` of the claude.ai GrabGPU connector | `mcp__seam-probe-mcp__ping` and `mcp__claude_ai_GrabGPU__find_gpu`. Format is `mcp__<server>__<tool>`; hyphens in a server name are kept; in the connector name the dot and space of `claude.ai GrabGPU` became `_`. Matcher `.*` caught both. Other names seen in all runs: `Agent`, `Read`, `Write`, `Bash`, `PowerShell`, `ToolSearch`, `SubagentHandback`. | as expected (recorded) |
| g | no terminal for commands | `node -e "console.log(process.stdin.isTTY, process.stdout.isTTY)"` through the Bash tool, then the PowerShell tool, headless | Bash tool output `undefined undefined`; PowerShell tool output `undefined undefined` (`PostToolUse` `tool_response.stdout`). The same command through this agent's own Bash and PowerShell tools also printed `undefined undefined`. Only headless and an agent session were observed; a plain interactive session was not. | as expected |
| h | builder edit prompts | needs an interactive session in default permission mode, builder writes a file | not observable headless | **PENDING-OWNER: needs an interactive session** |
| i | deny for one agent type | `PROBE_MODE=deny-read`, builder reads README.md | The read was refused. The builder's tool result (from its transcript, `is_error: true`) was exactly: `PreToolUse:Read hook error: PROBE-DENY-123: the probe plugin does not let builder agents read files.` It quoted that to the caller. No `PostToolUse` line was logged for the denied read. | as expected |
| j | hook time budget | `PROBE_MODE=vitest`: `npx vitest run` (vitest 5.1.2, one 1-line test) inside a `PreToolUse` hook, first run after `npm install vitest`, no `node_modules/.vite` yet | **3.51 s** measured inside the hook (hook total 3767 ms in the debug log; vitest itself reported `Duration 386ms`). Outside a hook, same project, three back-to-back runs (cache folder removed before the first): 3.94 s, 6.01 s, 4.19 s. Default hook timeout was not exercised in this run. | as expected (recorded). A 5 s hook timeout is too tight: one of these four timings (6.01 s) is over it. |
| k | forced continues | `PROBE_MODE=block-stop`, `SubagentStop` returns `{"decision":"block","reason":"..."}` every time (own cap 20), builder reads README.md | **0 forced continues.** `SubagentStop` fired once. Claude Code parsed the block, discarded it, and the subagent completed (see evidence). | **DIFFERS: expected up to 8 forced continues (docs), observed 0** |
| l | plugin data env | any hook (all 57 hook calls logged as received) | `CLAUDE_PLUGIN_DATA=<home>/.claude/plugins/data/seam-probe-inline` (forward slashes, folder already existed when the hook ran). Same value on every call. For a `--plugin-dir` plugin the folder is `<plugin name>-inline`; the installed-plugin name was not observed. `CLAUDE_PLUGIN_ROOT=<repo>/live-checks/probe-plugin`, `CLAUDE_PROJECT_DIR=<repo>/live-checks/scratch` (the launch folder). | as expected |

## Evidence

All lines below are from the raw hook log or the `--debug-file` output of the named run. The raw files are
git-ignored; these are trimmed copies.

**a, b** (run `ab`):

```
SubagentStart   agent_id=a21b07d77aea12f63 agent_type="seam-probe:builder"
PreToolUse      tool_name=Agent  (no agent_id, no agent_type)
PreToolUse      tool_name=Read   agent_id=a21b07d77aea12f63 agent_type="seam-probe:builder"
                tool_input={"file_path":"<repo>\\live-checks\\scratch\\README.md"}
```

**c** (run `c`): debug log. The same "status 1" line appeared for all four hook calls (`PreToolUse` and `PostToolUse` for `Write` and for `Read`); the `Write` one is shown:

```
Hooks: PreToolUse:Write [node <repo>\live-checks\probe-plugin/log-hook.mjs] (plugin seam-probe@inline) finished with status 1 (212ms)
[ERROR] "Hook PreToolUse:Write (PreToolUse) error: status code 1\nstderr:\nfile:///.../log-hook.mjs:105 ... Error: PROBE_MODE=crash: deliberate crash ..."
```

Then `File created successfully at: .../crash-test.txt`.

**d** (run `d`):

```
Hooks: PreToolUse:Write [node <repo>\live-checks\scratch\probe-plugin-d/log-hook.mjs] (plugin seam-probe@inline) timed out after 5000ms (5390ms)
Writing to temp file: ...timeout-test.txt.tmp... / File ...timeout-test.txt written atomically   (0.1 s later)
```

Four hooks ran (Write pre and post, Bash pre and post); each logged `sleep-start`, none logged `sleep-end`.
All four timed out after 5000 ms (5390, 5279, 5290 and 5274 ms measured). The whole run took 34.1 s.

**i** (run `i`), hook output and what the builder saw:

```
hook stdout: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"PROBE-DENY-123: ..."}}
debug:       Hook PreToolUse (...) returned permissionDecision: deny (reason: PROBE-DENY-123: ...)
builder tool_result (is_error=true): PreToolUse:Read hook error: PROBE-DENY-123: the probe plugin does not let builder agents read files.
```

**k** (run `k`, `PROBE_MODE=block-stop`), debug log:

```
Hooks: Parsed initial response: {"decision":"block","reason":"PROBE forced continue 1: reply with the single word \"again\"."}
Successfully parsed and validated hook JSON output
[end-turn] Stop hook block discarded (turn ended by tool result, no model re-invoke): block
[Stall] agent_completion ... agentType=seam-probe:builder exitPath=completed durationMs=6954 turns=2 finalStopReason=tool_use
```

Hook log for the run: one `SubagentStop` line (`stop_hook_active=false`), one `block` line (`n=1`), then the `Agent`
tool returned. No second `SubagentStop`. The block reason was written into the subagent transcript as a
`hook_blocking_error` attachment, but the model was never called again, so the builder never saw it.

Variant (run `k2`, `PROBE_MODE=block-stop-exit2`: exit code 2, reason on stderr): same result.

```
Hooks: SubagentStop [...] finished with status 2 (212ms)
[ERROR] "Hook SubagentStop (SubagentStop) error: status code 2\nstderr:\nPROBE exit-2 forced continue: reply with the single word \"again\"."
[end-turn] Stop hook block discarded (turn ended by tool result, no model re-invoke): block
```

What this suggests, not proven: every subagent in this version ends by calling a harness tool named
`SubagentHandback` (the subagent's instructions say "Only a SubagentHandback call reaches your caller as your
result"), so its last turn always "ended by tool result". Whether a block works when a subagent ends in plain
text, or in an interactive session, was not tested.

## Other facts the later tasks can use

All observed in the same runs.

- **Hook input shapes.**
  - Main-session `PreToolUse`: `session_id, transcript_path, cwd, prompt_id, permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id`.
  - The same call made from a subagent has the extra fields `agent_id` and `agent_type`.
  - `PostToolUse` adds `tool_response` and `duration_ms`.
  - `SubagentStart`: `session_id, transcript_path, cwd, prompt_id, agent_id, agent_type, hook_event_name` (no `permission_mode`).
  - `SubagentStop`: `session_id, transcript_path, cwd, prompt_id, permission_mode, agent_id, agent_type, effort, hook_event_name, stop_hook_active, agent_transcript_path, background_tasks, session_crons`.
- **`permission_mode` in the input:** `auto` for the owner's default, `acceptEdits` when passed on the command line.
- **`SubagentHandback` is hooked too.** The builder's final tool call fires `PreToolUse` and `PostToolUse` with
  `tool_name: "SubagentHandback"`. A guard that denies unknown tools for the builder must allow it.
- **A deny reason reaches the model as** `PreToolUse:<Tool> hook error: <permissionDecisionReason>`, marked as an error.
- **Path formats differ:** paths inside the stdin JSON use backslashes (`C:\Users\...`); `CLAUDE_PLUGIN_ROOT`,
  `CLAUDE_PLUGIN_DATA` and `CLAUDE_PROJECT_DIR` use forward slashes.
- **Hook command on Windows:** `node ${CLAUDE_PLUGIN_ROOT}/log-hook.mjs`, unquoted, worked because the path has no
  spaces (the log shows it expanded to `node <repo>\live-checks\probe-plugin/log-hook.mjs`). A path with spaces was
  not tried; other installed plugins' hook commands in the debug log quote the path, so quote it in the real plugin.
- **Other plugins' hooks run alongside** (the owner's own installed plugins). In these runs they returned without blocking anything.

## Re-running

From `live-checks/scratch/` (git-ignored; holds a `README.md`, the run wrapper, the throwaway MCP script and a one-test vitest project):

```
PROBE_RUN=ab claude -p --plugin-dir <repo>/live-checks/probe-plugin "Use the seam-probe:builder agent to read README.md" \
  --model haiku --max-turns 8 --output-format json --debug-file debug-ab.log
PROBE_MODE=crash PROBE_RUN=c claude -p --plugin-dir <repo>/live-checks/probe-plugin "Create a file named crash-test.txt ..." \
  --model haiku --permission-mode acceptEdits --output-format json --debug-file debug-c.log
```

Results land in `live-checks/out/hook-log.jsonl`, one line per hook call, with the run label in the `run` field.
If the runs are started from inside another Claude Code session, unset that session's `CLAUDE_CODE_*` identity vars first.
