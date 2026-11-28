// Which decision a tool call goes to. The decision modules are loaded when they are needed, with
// `import()`, so a hook run pays only for the one it uses (Ruling R29). The write decision is async for the
// same reason one level down: it loads the TypeScript parser only when a builder's code or a contract has to
// be read (R47), so a write decided by the kind of path alone stays as quick as a read.
//
// A halted run (the main AI changed a protected file, 6.6) stops every write and every command here, before
// the decisions, except the few commands that start the owner's recovery (R77); reads stay open so the owner can look. A write or command that is let through is noted as
// under way, with the files a write may change, for the tamper check that follows it (inflight.ts).
import type { Ctx, Decision, HookInput } from '../types.ts';
import type { HookEvent } from './output.ts';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);

const ALLOW: Decision = { kind: 'allow' };

const halted = (why: string): Decision => ({
  kind: 'deny',
  reason: `The run is halted: ${why}. Nothing can be written or run until the owner clears it: open the Seam Approve window on your desktop to look at it and carry on. (Meanwhile seam report is allowed, and seam request park or seam request edit to ask the owner.)`,
});

/** The files a write tool names, from the repo root (folded on Windows), for the note of what it may change. */
async function writtenBy(input: HookInput, ctx: Ctx): Promise<string[]> {
  const { rel, resolveReal } = await import('../lib/paths.ts');
  const { fieldTargetsOf } = await import('./request.ts');
  const root = resolveReal(ctx.root, '.');
  return fieldTargetsOf(input).flatMap((target) => {
    const inRepo = rel(root, resolveReal(input.cwd, target));
    return inRepo === null || inRepo === '' ? [] : [inRepo];
  });
}

/** Note an allowed write or command as under way, and pass the decision on. */
async function noteStarted(input: HookInput, ctx: Ctx, decision: Decision, writes: boolean): Promise<Decision> {
  if (decision.kind === 'allow') (await import('./inflight.ts')).started(ctx, input, writes ? await writtenBy(input, ctx) : []);
  return decision;
}

/**
 * Before a tool runs: a write goes to `decideWrite`, a shell command to `decideCommand`, a read to
 * `decideRead`; any other tool is not the guard's business. After a tool ran (any tool): the tamper check,
 * whose problems come back as one refusal. `restored` are record files the hook put back to build `ctx` (run.ts).
 */
export async function decide(input: HookInput, event: HookEvent, ctx: Ctx, restored: readonly string[] = []): Promise<Decision> {
  if (event === 'PostToolUse') {
    const { checkTamper } = await import('./tamper.ts');
    const { problems } = await checkTamper(input, ctx, restored);
    return problems.length === 0 ? ALLOW : { kind: 'deny', reason: problems.join('; ') };
  }
  const tool = input.tool_name ?? '';
  const writes = WRITE_TOOLS.has(tool);
  if (writes && ctx.state.halted !== null) return halted(ctx.state.halted);
  if (writes) return noteStarted(input, ctx, await (await import('./write.ts')).decideWrite(input, ctx), true);
  if (COMMAND_TOOLS.has(tool)) {
    const command = await import('./command.ts');
    if (ctx.state.halted !== null && !command.mayRunWhileHalted(input, ctx)) return halted(ctx.state.halted);
    return noteStarted(input, ctx, command.decideCommand(input, ctx), false);
  }
  if (READ_TOOLS.has(tool)) return (await import('./read.ts')).decideRead(input, ctx);
  return ALLOW;
}
