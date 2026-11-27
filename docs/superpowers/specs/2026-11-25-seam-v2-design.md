# seam-v2: design

Status: draft for the owner's approval. Date: 2026-11-25.

## 1. What this is and why

seam-v2 is a Claude Code plugin that makes an AI build an app the seam-driven way: plan the
handoff points (seams) first, write every file as a skeleton, lock the plan and tests, then
fill in the code one file at a time.

It replaces an earlier kit. That kit had rules, but an AI could get around them. In one run
it wrote the real code, deleted parts to pass the "this is still a skeleton" check, then
put the code back. A test of the old guard showed six other ways through (section 9).

The owner's idea drives the whole design: **the AI will take the easy way, so make the right
way the easy way.** If the AI games the system, gaming it should be the same as doing the
work properly. In practice:

- Guards judge **what happened** (history, fingerprints, who did it), not how a file looks
  at one moment.
- The AI never marks its own work done. A script runs the tests, a fresh checker reads the
  code, and only the human approves the big steps.
- Every role gets only the tools it needs. The main AI plans and coordinates but writes no
  code. A fresh builder writes one file and nothing else.

The plugin also has to work on **existing apps**. The owner usually has an AI build a quick
experimental version first; seam-v2 is how that version is rebuilt properly, beside the old
one.

## 2. Goals, non-goals, anti-goals

**Goals**

1. Each known cheat (section 9) is blocked or caught, and a cheat test proves it.
2. Code gets into the app only through the build loop: a builder fills a frozen skeleton,
   the guard's tests pass, and the checker agrees.
3. The human makes few, short decisions, by typing them. The AI cannot make them.
4. Works on a new app and on an existing app (rebuild beside it).
5. Plain-English record of everything, so the owner can follow it without reading code.

**Non-goals**

- Other tools (Cursor, Codex). Claude Code only.
- Languages other than TypeScript. Apps use TypeScript, Zod and Vitest.
- Perfect security against someone with full shell access on the machine (section 10).
- Reusing code from the old kit. This is a fresh build; the old kit is only a lesson.

**Anti-goals** (it works but still failed)

- The AI passes by softening the exam: vague steps, weak tests or skipped tests. Called
  out as the biggest risk.
- So many approvals that the owner rubber-stamps them.
- Guard rails so heavy that honest work stalls, and the AI's only move is to route around
  them.
- A guard that says "allowed" with no record of why. Every block and every pass is logged.

## 3. Constraints

- Plugin lives in `C:\Users\trap\plugin-src\seam-v2`, its own git repo. Never inside Street
  Royalty or any app repo.
- Hooks must cover every write path: `Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell`
  (PowerShell must be named; the old kit missed it).
- What Claude Code can and can't do (checked in its docs):
  - Hooks fire inside subagents and say which agent type is calling.
  - SubagentStop can refuse to let a subagent finish.
  - Plugin agents honor `tools`/`disallowedTools` but ignore frontmatter `hooks`,
    `permissionMode`, `mcpServers` and `initialPrompt`.
  - The advisor can't be forced or block anything, so it isn't a checker.
  - Plugins can ship Workflows (deterministic scripts that run subagents). Workflow scripts
    can't touch files, and each run asks the user for approval.
- Windows is the owner's machine. Scripts are Node (no bash-only tooling).

## 4. Approaches

| Approach | What it means | Trade-off |
|---|---|---|
| **A. Build in stages (chosen)** | Stage 1: cheat tests + guard. Stage 2: planning (survey, plan checker, skeleton script). Stage 3: build loop + builder/checker + strikes. Stage 4: probes, fixtures, flips. Each stage tried on a tiny practice app before the next. | Slower to a full plugin, but the guard is proven before anything relies on it, and each stage is small enough to test hard. |
| B. Build it all at once | Write every part, then test. | Faster on paper. But guard bugs would only show up in the full loop, where they're hardest to find, which is how the old kit failed. |
| C. Patch the old kit | Fix the seven holes in the existing code. | Least work, but the owner wants a fresh start, and the old guard's core (judging snapshots) is the flaw. |

Owner chose fresh (not C). Stages (A) is Claude's call; the owner hasn't objected.

## 5. Roles: who may do what

The guard enforces this table. Hooks know which agent is calling, so "who" is checkable.

| Role | Is | Can write | Can read | Terminal |
|---|---|---|---|---|
| **Human** | the owner | approvals, by typing | everything | yes |
| **Main AI** | the session Claude | planning files (in planning phases only), tests (in the tests phase only) | everything | limited (below) |
| **Surveyor** | fresh subagent, read-only | nothing (returns a draft the main AI saves) | the old app | no |
| **Builder** | fresh subagent, one per file try | only the bodies of its one assigned file | its file, contracts, plan sentences; **not** tests or fixtures | no |
| **Describer** | fresh subagent, read-only | nothing | only the comment-stripped copy of one file | no |
| **Checker** | fresh subagent | only its verdict file | plan, describer's account, stripped code, tests (when reviewing tests) | no |
| **Scripts and hooks** | Node code in the plugin | skeletons, fixtures (probe script only), records, log, phase | everything | n/a |

Main AI terminal: in build phases only an allowlist runs (the plugin's `seam` commands,
`git status/log/diff`, `npm test`, `npm install` with approval). In planning phases it is
freer, but the tamper check (section 6.3) still runs after every command.

## 6. How it works

### 6.1 The phases

Phases are stored in `.seam/phase`. Only a script moves the phase, and only after a human
approval (6.4).

1. **survey** (existing apps only). The surveyor reads the old app and drafts
   `plan/inventory.md`: screens, outside services with exact endpoints, data, auth, env vars,
   and UI failure states. The human corrects it. Approval 1 also locks `plan/FEATURES.md`.
2. **plan**. Main AI writes the seam list (8 to 15 seams), contracts (Zod, in `contracts/`)
   and, per file: purpose, inputs, outputs, signatures, numbered steps (3 or more), and
   promises (plain sentences the file must make true, each with an ID). Build order puts
   config, auth and state first. The **checker reviews the plan**: every step must be
   specific and checkable ("add the second price to the first", not "handle the data").
   Vague steps go back to the main AI.
3. **probe**. The probe script makes real calls to outside services (or to the old app) and
   saves them in `probes/fixtures/`. Only this script writes fixtures. This comes before
   skeletons so contracts are based on real responses.
4. **skeleton**. A script writes every planned file from the plan: header, signatures, a
   numbered `// Step N:` marker per step inside each body, and
   `throw new Error('SKELETON: not built yet')`. Nobody else writes code files here.
5. **tests**. Main AI writes tests, each tagged with the promise ID it checks. Then:
   - The checker confirms each test really checks its promise, and that every promise has a test.
   - A script confirms none are skipped (`.skip`, `.todo`, `it.only`, empty bodies).
   - A script runs them all and confirms every one **fails with the SKELETON error**.
     A test that passes on an empty skeleton, or fails for another reason, is rejected.
6. **Approval 2: freeze.** The human approves the plan, skeletons and tests together (one
   short summary). A script records fingerprints of everything frozen (6.2).
7. **build**. The build loop (6.5) fills files one at a time, in build order, against
   mocks made from fixtures.
8. **flip**. For each seam, mock to real: the real adapter must pass `tests/real/`.
   The guard runs these too. Flips are approved in one batch (approval 3).
9. **cutover** (existing apps). When every line of `CUTOVER.md` is ticked by a script check,
   the human approves the switch (approval 4).

### 6.2 Freeze and fingerprints

At freeze, a script writes `.seam/lock.json`: for every code file, a fingerprint of all of
it **except the bodies** (header, steps, signatures, exports, imports list, step markers),
plus whole-file fingerprints of the plan, contracts, tests and fixtures. A copy is kept in
the plugin's data folder outside the repo.

After freeze, the only legal change to a code file is inside its bodies, between the step
markers, made by the builder whose turn it is. The script reads files with the TypeScript
compiler (not regex), so a change to a signature, header or step is detected however it
was written.

This is what closes the old cheats: "is this still a skeleton?" is replaced by "does this
file still match what the human approved, and did the right agent change only the bodies?"

### 6.3 The guard

All in Node, registered as plugin hooks.

- **Before any write** (PreToolUse on `Edit|Write|MultiEdit|NotebookEdit`): checks the role
  table, the phase, the turn (which file the builder owns right now), and the fingerprints.
  Blocks with a plain message saying what was blocked and why.
- **Before any command** (PreToolUse on `Bash|PowerShell`): applies the allowlist for the
  phase. Blocks `--no-verify` and edits to `.seam/` or the plugin's own files.
- **After any tool, any agent** (PostToolUse): the tamper check. It compares protected files
  (frozen parts, `.seam/`, plan, tests, fixtures, old app, plugin files) with the record.
  Any change it didn't expect is put back from the record, logged, and counted as a strike
  against whoever made it. This catches writes made through a command, which can't be fully
  read in advance.
- **Before reads** (PreToolUse on `Read|Glob|Grep`): the builder may not read tests or
  fixtures; the describer may only read its stripped file.
- **When a builder tries to finish** (SubagentStop): the guard runs that file's tests and the
  code rules (no silent catch, no `any`, no `ts-ignore`, at most 200 lines, only
  `src/config` reads env). If any fail, it refuses the finish and tells the builder **which
  promise** failed, in words, never the test code. See 6.6 for limits.
- **When a subagent starts** (SubagentStart): for a builder, a script picks the next unbuilt
  file in build order, records the turn, and injects the file path and its promise sentences
  into the builder's context. This hook can add context but cannot refuse a start, so a
  builder started out of turn simply owns no file and can write nothing.
- Hook scripts read the calling agent's type from the hook input and decide in code. The
  docs call the hooks' `if` filter best-effort, so it is not used for enforcement.
- Guard records (test results, turns, strikes) are written by hook processes, which are not
  tool calls, so no agent can forge them through a tool.

### 6.4 Approvals: only the human

Claude Code's docs say the "user typed a prompt" hook also fires for prompts that are not
typed by a person (background helpers reporting back, scheduled tasks, other sessions). So a
phrase typed in the chat cannot prove a human approved. **Open question for the owner (see
section 14).** Claude's recommended way:

- The human approves in **their own terminal window**, outside Claude Code:
  `seam approve`. The script shows the one-screen summary and asks the human to type back a
  fresh code it displays. It refuses unless it is talking to a real keyboard (an interactive
  terminal); Claude's command tool never has one.
- The guard also blocks the AI from running `seam approve` at all, and blocks tools that fake
  an interactive terminal. Two locks, either is enough on its own.
- The approval is written by the script to the record and the data folder, and logged.

The code changes each time, so an old approval can't be replayed.

The four approvals: (1) inventory + features, (2) freeze, (3) flips, (4) cutover. The human
also decides when a file strikes out or a builder is stuck, and any plan change after freeze.

### 6.5 The build loop

Shipped as a plugin Workflow (`/seam-v2:build`). For each file in build order:

1. A **builder** starts fresh. The guard gives it its turn (the next unbuilt file in build
   order, chosen by the script, never by the AI) and its promise sentences.
2. It fills the bodies. On finish, the guard runs the tests (6.3).
3. A **describer** gets the file with comments stripped and says what the code does,
   without seeing the plan.
4. A **checker** compares that account and the code with the plan's steps and promises,
   then writes its verdict file.
5. A script records the file as done only if all three hold: guard's test record passes,
   fingerprints intact, checker verdict passes. "Done" is never set by the AI.

**Not yet proven:** the docs don't say whether a Workflow can start the plugin's own agent
types, or whether hooks fire (with the agent type) for agents a Workflow starts. Stage 3
begins with a small test of both. If either fails, the fallback is a skill that has the main
AI start each builder, describer and checker with the normal agent tool, in a loop driven by
`seam next`. The guard works the same either way.

The workflow is the convenient path, not the only gate. If the main AI skips it, nothing is
gained: only a builder can write code, and only a script can mark a file done.

### 6.6 Strikes and "I'm stuck"

- A builder gets a fixed number of test runs per try (Claude's call: 5). If it still fails,
  the guard lets it stop and records **strike 1**. The file is reset to its skeleton and a
  fresh builder starts, with a one-line note on what went wrong.
- **Strike 2** goes to the human, with the plain log of both tries.
- A tamper (6.3) is a strike too.
- A builder may instead say it is stuck, in a fixed form: the step number and what it tried.
  The guard checks the form, resets the file (stuck counts as nothing done), and asks the
  human. A vague "I'm stuck" is refused.

### 6.7 Plan changes after freeze

If a builder or the main AI finds the plan is wrong (a contract can't work, a step is
impossible), it asks to reopen a seam. The human approves by typed code. The seam's files go
back to the skeleton phase, the change is written to `plan/DRIFT-LOG.md`, and the seam goes
through review and freeze again. Other seams stay frozen.

### 6.8 The plain-English log

Scripts and hooks append to `.seam/log.md` in plain sentences:
"10:42 Builder started on src/orders/total.ts (try 1 of 2)." "10:47 Blocked: the main AI
tried to change tests/orders.test.ts after freeze." Agents can't write to it.
`seam report` prints a one-screen status from it.

### 6.9 Existing apps: rebuild beside

- At setup the plugin asks: **new branch** (default) or **new repo**. A branch keeps
  history and makes the switch a merge. A new repo suits rebuilds that change most of the
  tech.
- The old app is frozen and protected by the guard (no writes, by anyone). It stays
  runnable, so probes can record its real behavior as fixtures.
- The new app is planned and built next to it (Claude's call: in a folder `seam-app/` on
  branch `seam/rebuild`; in a new repo, at its root).
- `CUTOVER.md` lists what must be true before switching (every inventory screen and service
  covered and green). A script ticks lines; the human approves the switch.

### 6.10 GitHub check

A CI workflow in the app repo re-runs, from scratch, on each pull request: fingerprints
against `lock.json`, every code file in the plan, no skipped tests, all tests green, code
rules. Any change to `lock.json`, the plan or tests in the PR is listed loudly in the
summary. This is the backstop for anything done on the local machine that the hooks missed.

## 7. Cheat tests (written first)

The plugin repo has a test suite that plays an AI trying to cheat. Each test sets up a
temporary app, feeds the guard fake tool calls (as Claude Code would send them), and checks
the result. They are written before the guard and must fail first. The set starts with the
seven holes found in the old kit plus the delete-and-restore trick, and grows whenever a new
cheat is found. See section 9.

## 8. What the owner sees

- A few typed approvals, each with a one-screen summary.
- Questions only when a file strikes out, a builder is stuck, or the plan needs to change.
- `seam report` and `.seam/log.md` for status, in plain words.

## 9. Known cheats and how each is closed

| # | Cheat | Old kit | Closed by |
|---|---|---|---|
| 1 | Write real code during skeleton phase | blocked | only the skeleton script writes code files in that phase |
| 2 | Same code through a shell command | **allowed** | tamper check after every tool, any agent; reverted + strike |
| 3 | AI marks its seam green, then writes code | **allowed** | green/done is set only by a script from guard records |
| 4 | Swap approved steps for different ones in build | **allowed** | fingerprints of everything but bodies |
| 5 | Edit the file list / manifest in build | **allowed** | plan is frozen and fingerprinted |
| 6 | Put code in a folder the guard doesn't watch | **allowed** | every code file anywhere must be in the plan |
| 7 | Move to build with finished code and fake status | **allowed** | phase moves only on a typed human approval |
| 8 | Write code, trim it to pass, then restore it | happened in practice | no AI writes code before build; in build, fingerprint + turn checks |
| 9 | Soften the exam (vague steps, weak or skipped tests) | not checked | checker reviews plan and each test; skip scan; tests must fail on skeletons |
| 10 | Edit the guard or its records | not checked | guard protects plugin files and `.seam/`; data-folder copy; CI check |
| 11 | Hide code in comments the checker trusts | not checked | describer reads stripped code without the plan |
| 12 | Fake an approval | commit-message tag | approvals come only from a typed prompt with a fresh code |
| 13 | Builder reads the tests and codes to them | not checked | builder can't read tests or fixtures; gets sentences only |

## 10. Honest limits

- An AI with a shell on this machine can, in principle, edit anything, including the
  plugin's data folder. The tamper check and the CI check make that loud and undoable, not
  impossible.
- Checkers are AIs too. They can miss things. The describer-first order and comment
  stripping make honest review the easy path, not a guarantee.
- The human approving is the final check. Keeping approvals few and short is how the design
  protects that.

## 11. Build stages

1. **Guard first.** Start by confirming, in a live session, the exact agent-type name a
   plugin agent reports to hooks (the docs imply `seam-v2:builder` but don't say). Then cheat
   tests, then the guard until they all pass: role table, phases, fingerprints, tamper check,
   approvals, log. Tried on a tiny practice app.
2. **Planning.** Survey, plan format and checker review, skeleton script, test checks
   (skip scan, must-fail-first), freeze.
3. **Build loop.** Builder, describer and checker agents, SubagentStop test runs, strikes,
   stuck, the Workflow.
4. **Probes and flips.** Probe script and fixtures, mocks from fixtures, `tests/real/`,
   flips, cutover, CI check.

Each stage ends with its cheat tests green and one run on the practice app.

## 12. Left to the builder

- Exact file formats (plan file, `lock.json`, records), as long as a script parses them
  strictly and the human can read the plan.
- Folder layout inside the plugin, command names beyond `seam report`, and how the hook
  scripts are split.
- The exact allowlist of commands per phase.
- How the tamper check stores its record and how fast it runs (it runs after every tool).
- Which practice app to use for each stage.

## 13. Calls Claude made (owner can override)

- Build in stages, guard first (section 4).
- Plugin at `C:\Users\trap\plugin-src\seam-v2`; Claude Code only; TypeScript, Zod, Vitest.
- At setup for an existing app, offer new branch or new repo; default new branch, new app in
  `seam-app/` on `seam/rebuild`.
- Five test runs per builder try before a strike.
- Step markers inside bodies, so code sits under the step it does.
- Four approvals: inventory, freeze, flips (one batch), cutover.
- Five test runs per try also stays under Claude Code's cap of 8 forced continues.

- **New apps:** the main AI drafts `plan/FEATURES.md` with the owner in conversation.
  Approval 1 is "features" for a new app and "inventory + features" for an existing one.
  Planning can't start before approval 1.
- **Probe before contracts:** the plan phase is split. First the seam list and the outside
  services. Then the probe. Then contracts, written from the real responses, and the checker's
  plan review. An app with no outside services skips the probe.
- **Mocks and real adapters are planned files** that builders fill like any other. Read rules
  depend on the kind of file. A builder filling a mock or an adapter may read its own seam's
  fixtures. It still can't read tests. `tests/real/` is written in the tests phase and frozen
  at approval 2.
- **Secrets:** API keys live in a local env file that only `src/config` reads and git
  ignores. The CI check runs `tests/real/` only when started by hand or once a night, never on
  every PR (that would cost money).
- **Reopened seams:** a script builds the import map. When a seam is reopened, every done file
  that imports from it goes back to "needs re-test". If its tests fail after the seam is
  re-frozen, it is reset and rebuilt through the normal loop.
- **Builders can read the files their file imports**, including already-built ones, so they
  see real signatures. They still can't read tests.
- **Cutover is a pull request**, never a direct change to `main`. It moves `seam-app/` to the
  root and removes the old app. The owner merges it. The plugin never deploys.

## 14. Owner's answers (2026-11-25)

1. **Where it runs:** the Claude Code desktop app and the terminal CLI, both on the owner's
   Windows machine. Cloud, web and phone sessions are not supported.
   **How approvals work (follows from that, as described in 6.4):** `seam approve` runs in a
   separate window with a real keyboard. Setup installs `seam` so it works outside Claude Code,
   and puts a "Seam Approve" shortcut on the desktop that opens that window, so approving
   from the desktop app is a double-click.
2. **Screens go through the build loop.** Components and routes are planned files with steps
   and promises. Builders fill them, and Vitest with Testing Library checks them by simulating
   the page. The skeleton script, body fingerprints and must-fail-first rule cover TSX
   components: a skeleton component throws the SKELETON error, and its steps sit as markers
   in the function body. After build, a separate design pass may change styling (class
   names, CSS, layout markup) but not logic. Its changes are checked to touch only styling,
   and the tests are re-run.
