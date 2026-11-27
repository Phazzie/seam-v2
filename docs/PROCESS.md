# How seam-v2 works, start to finish

This is the whole process in plain English: what happens, who does it, and when you step in.
The full reasoning is in the design doc
([`docs/superpowers/specs/2026-11-25-seam-v2-design.md`](superpowers/specs/2026-11-25-seam-v2-design.md));
this page is the guided tour.

> **Status:** the design is approved. Stage 1 (the guard) is being built now. Some steps
> below describe stages that don't exist yet. The [build stages](#build-stages) section at
> the end says what's ready.

---

## The idea in one paragraph

An AI coding agent will take the easiest path to "done". seam-v2 makes the right way the
easiest way. It plans the app first, writes every file as an empty skeleton, locks the
plan and tests, and then has a fresh helper fill in one file at a time. Scripts do the
bookkeeping. The AI never marks its own work done. You approve only the few big steps. A
guard sits underneath as a seatbelt: it blocks shortcuts and logs them in plain English.

## Words used on this page

| Word | Meaning |
|---|---|
| **Seam** | A handoff point in the app: where one part passes data to another (the login, the payment service, the order list). An app usually has 8 to 15. |
| **Contract** | The exact shape of the data crossing a seam, written as a Zod schema. |
| **Skeleton** | A file with everything except the working code: a header saying what it does, its numbered steps, its function signatures, and a body that just says "not built yet". |
| **Promise** | A plain sentence a file must make true ("adds the second price to the first"). Each test checks one promise. |
| **Probe** | A real call to an outside service, saved so the app can be built against real answers. |
| **Mock** | A stand-in for an outside service, built from the saved probe answers. |
| **Flip** | Switching a seam from its mock to the real service. |
| **Freeze** | The moment you approve the plan, skeletons and tests. After that, they can't quietly change. |
| **Guard** | The plugin's hooks: they check every file change, command and read, and block anything outside the rules. |

## Who does what

| Who | What they do | What they can't do |
|---|---|---|
| **You** | Approve the big steps, decide on files that got stuck, merge the final pull request. | — |
| **Main AI** (your Claude session) | Plans with you, writes the contracts and tests, runs the process. | Write app code. Run commands outside a short list. Approve anything. |
| **Surveyor** | For an existing app: reads it and drafts a list of everything it does. | Write anything. |
| **Builder** | A fresh helper for each file. Fills in the code under each step. | Touch any other file. Read the tests. See strike counts. |
| **Describer** | Reads the finished code with comments removed and says what it does, without seeing the plan. | Write anything. |
| **Checker** | Compares the describer's account and the code with the plan, and judges whether each test matches its promise. | Write anything except its verdict. |
| **Design pass** | After the build, restyles screens. | Change anything except styling. |
| **Scripts** | Write skeletons, record results, pick the next file, move the phase after your approval. | — |

## Getting started

**New app:** open Claude Code in an empty folder and type `/seam-v2:start`.

**Existing app (rebuild it properly):** open Claude Code in that app's repo and type
`/seam-v2:start`. It asks:

- **New branch** (the default): the new app is built in a `seam-app/` folder on a branch
  called `seam/rebuild`, next to the old app. History is kept, and the switch at the end is
  a pull request.
- **New repo:** better when the rebuild changes most of the app's technology.

Either way, the old app is never touched. It stays runnable so the plugin can record how it
really behaves.

Setup also:
- installs a **"Seam Approve" shortcut** on your desktop;
- lets the plugin's own commands run without Claude Code asking each time, so overnight runs
  don't stall;
- shows you any of the repo's existing instructions (`CLAUDE.md`, `AGENTS.md`, hooks) that
  conflict with the seam rules.

## The steps

### 1. Survey (existing apps only)

The surveyor reads the old app and drafts an **inventory**: every screen, every outside
service with its exact address, the data, how login works, and what the user sees when
things fail. A script checks the draft against the app's real routes and imports, so a
screen can't quietly go missing. You correct the list.

For a new app, the main AI writes a **features list** with you instead.

**→ Approval 1: you approve the inventory and features.** Planning can't start before this.

### 2. Plan, part 1: seams and services

The main AI lists the seams and the outside services each one talks to.

### 3. Probe

A script calls each outside service (or the old app) and saves the real answers. It only
calls addresses from your approved list. Calls that change something real, like placing an
order or sending an email, are only made with your approval. An app with no outside
services skips this step.

### 4. Plan, part 2: contracts and files

From the real answers, the main AI writes the **contracts**: data shapes only, no code
allowed. Then, for every file:
- what it's for, its inputs and outputs;
- its function signatures;
- **at least 3 numbered steps**, specific enough to check ("add the second price to the
  first", not "handle the data");
- its **promises**, including any exact text a screen must show.

It also sets the **build order**: config, login and shared state first, and every file after
the files it uses.

A fresh **checker** then reviews the plan. Vague steps go back to be rewritten. A script
checks that every feature on your list has at least one promise.

### 5. Skeletons

A script writes every planned file as a skeleton from the plan. Nobody else writes code
files at this point.

### 6. Tests

The main AI writes the tests, each labelled with the promise it checks. Then:
- the checker confirms each test really checks its promise, and that every promise has a test;
- a script confirms no test is skipped and every test actually checks something;
- a script runs them against the skeletons: **every test must fail**, because nothing is
  built yet;
- a script also runs them against "hollow" versions that return empty answers: tests must
  fail there too, so a test that only checks "it didn't crash" is caught. Honest
  "empty case" tests ("shows nothing when logged out") are marked as exceptions and listed
  for you.

### 7. Freeze

**→ Approval 2: you approve the freeze.** You get one plain-English page:
- what will be built;
- the three riskiest items;
- any feature with no promise, and the test exceptions;
- the addresses the probe called;
- which files many others depend on.

After you approve, a script records a fingerprint of everything that was frozen: each file's
header, steps and signatures, plus the plan, contracts, tests, saved answers and config
files.

### 8. Build (can run overnight)

Files are built one at a time, in build order:

1. A **fresh builder** starts. The script, not the AI, decides which file is next. The builder
   gets that file and its promises, and nothing else to do.
2. It writes the code under each step. It can check its file for type errors as often as it
   likes.
3. When it says it's done, the guard runs that file's tests. If one fails, the builder is told
   which promise failed and what came out (never the test code), and tries again. It gets 5
   test runs.
4. The **describer** reads the code with comments removed and says what it does.
5. The **checker** compares that with the plan and gives a verdict.
6. A script marks the file done only if the tests passed, the frozen parts are untouched, and
   the checker agrees.

**When a file is hard:**
- A builder can say **"I'm stuck"**, naming the step and what it tried. Its instructions say
  that's a good result. A fresh builder then gets one more try, with that note.
- If a test looks wrong, the checker compares it with its promise before the second try. A
  wrong test comes to you instead of wasting builders.
- After **two failed tries**, the file is **parked**: set aside with a plain log of both tries.
  The build **keeps going** with every file that doesn't depend on it.
- The run only stops when nothing buildable is left, or if the main AI tampers with a
  protected file.

**Overnight:** approve the freeze in the evening and leave Claude Code open, with the
computer awake. In the morning, `seam report` tells you:
- what got built;
- what's parked and why;
- how often the guard blocked something;
- what needs you.

*(How a run keeps itself going all night is part of the stage 3 design. See [build stages](#build-stages).)*

### 9. Flip

Each seam is switched from its mock to the real service, and must pass its real-service
tests. **→ Approval 3: you approve the flips together.**

### 10. Design pass (screens)

A design helper can restyle screens: CSS, class names, style values. A script checks the
change was styling only, and the tests run again.

### 11. Cutover (existing apps)

When every line of `CUTOVER.md` is ticked, meaning every screen and service from the
inventory is built and passing, the plugin opens a **pull request** that swaps the new app in
for the old one. **→ Approval 4: you merge it.** The plugin never changes `main` directly and
never deploys.

## Your approvals

You approve in the **Seam Approve** window (the desktop shortcut), never in the chat. Chat
messages can come from automated sources, so a typed "yes" there can't prove it was you.
The window shows a one-screen summary and a short code, and you type the code back. The AI is
blocked from opening this window.

| # | When | What you're saying yes to |
|---|---|---|
| 1 | after the survey | the inventory and features are right |
| 2 | after tests | freeze the plan, skeletons and tests |
| 3 | after the build | switch the seams to the real services |
| 4 | at the end | the cutover pull request (you merge it) |

You may also be asked about a parked file, a test the checker thinks is wrong, or a change to
the plan after the freeze.

## Changing the plan after the freeze

Sometimes the plan turns out wrong: a contract can't work, or a step is impossible. The AI
asks to reopen that seam, and you approve it in the window. The approval page lists, in plain
words, any promise or test that would be removed or weakened. The seam is re-planned, checked
and re-frozen, and every file that uses it is re-tested. Each change is written to
`plan/DRIFT-LOG.md`.

## What the guard stops

It's a seatbelt for the shortcuts coding AIs really take. It isn't built to stop a
determined hacker. Some of what it blocks:

- **Writing real code before the build,** including through a shell command.
- **The AI marking its own work done,** or moving to the next phase on its own.
- **Changing approved steps, signatures or the plan** during the build.
- **Code in a file that isn't in the plan.**
- **Softening the exam:**
  - vague steps;
  - skipped or empty tests;
  - tests that pass on an empty file;
  - editing tests after they're approved.
- **Turning the tests off through settings files,** or switching the plugin off.
- **Hiding real logic in contracts or test helpers.**
- **Builders reading the tests,** or hard-coding the expected answers.
- **Background processes** started to sneak in changes later.
- **Approving on your behalf.**

When the guard blocks something, it explains why in plain English, writes it to
`.seam/log.md`, and counts it. If the count gets high, the fix is to make the right way
easier, not to add more walls.

Anything changed outside the rules, including through a command, is put back automatically.
If the main AI does it, everything stops until you look.

The full list, with how each block works, is section 9 of the design doc. The cheat tests in
`test/cheats/` prove each one.

## Where things live (in your app)

| Path | What it is |
|---|---|
| `plan/` | inventory, features, the plan (`plan.json`), the drift log |
| `contracts/` | data shapes (Zod) |
| `probes/`, `fixtures/` | saved real answers |
| `src/` | the app |
| `tests/` | tests (`tests/real/` for real-service tests) |
| `.seam/` | the plugin's records: phase, lock, approvals, log. Don't edit by hand. |
| `CUTOVER.md` | the switch-over checklist |

Need to edit a file yourself? Use `seam edit <file>` from the approval window, so your
change isn't mistaken for tampering.

## Build stages

The plugin itself is built in four stages. Each is tested against its cheats and tried on a
small practice app before the next one starts.

| Stage | What it adds | Status |
|---|---|---|
| 1 | The guard, the cheat tests, the approval window, `seam report` | **building now** |
| 2 | Planning: survey, plan checker, skeleton writer, test checks, freeze page | planned after stage 1's live checks |
| 3 | The build loop: builder, describer, checker, parking, overnight runs | needs a second short design pass first |
| 4 | Probes, mocks, flips, cutover, the GitHub check | needs a second short design pass first |

Progress is tracked in this repo's GitHub issues and the Stage 1 milestone.
