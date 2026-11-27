# seam-v2

A Claude Code plugin for **seam-driven development** with guard rails an AI can't quietly
game. It plans the app first, writes every file as a skeleton, locks the plan and tests,
then has a fresh helper fill in one file at a time. You approve only the big steps.

The core idea: **the AI will take the easy way, so make the right way the easy way.**

- **How it works, start to finish:** [docs/PROCESS.md](docs/PROCESS.md)
- **Full design and reasoning:** [docs/superpowers/specs/2026-11-25-seam-v2-design.md](docs/superpowers/specs/2026-11-25-seam-v2-design.md)
- **Stage 1 build plan:** [docs/superpowers/plans/2026-11-27-stage-1-guard.md](docs/superpowers/plans/2026-11-27-stage-1-guard.md)
- **Progress:** GitHub issues, milestone "Stage 1: Guard"

**Status:** design approved; stage 1 (the guard and its cheat tests) in progress. Not usable yet.

Claude Code only. Apps are built with TypeScript, Zod and Vitest. Windows first.
