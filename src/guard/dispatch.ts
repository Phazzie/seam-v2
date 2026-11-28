// Which decision a tool call goes to. The decision modules are loaded when they are needed, with
// `import()`, so a hook run pays only for the one it uses (Ruling R29). The write decision is async for the
// same reason one level down: it loads the TypeScript parser only when a builder's code or a contract has to
// be read (R47), so a write decided by the kind of path alone stays as quick as a read.
import type { Ctx, Decision, HookInput } from '../types.ts';
import type { HookEvent } from './output.ts';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);

const ALLOW: Decision = { kind: 'allow' };

/**
 * Before a tool runs: a write goes to `decideWrite`, a shell command to `decideCommand`, a read to
 * `decideRead`; any other tool is not the guard's business. After a tool ran (any tool): the tamper check,
 * whose problems come back as one refusal.
 */
export async function decide(input: HookInput, event: HookEvent, ctx: Ctx): Promise<Decision> {
  if (event === 'PostToolUse') {
    const { checkTamper } = await import('./tamper.ts');
    const { problems } = checkTamper(input, ctx);
    return problems.length === 0 ? ALLOW : { kind: 'deny', reason: problems.join('; ') };
  }
  const tool = input.tool_name ?? '';
  if (WRITE_TOOLS.has(tool)) return await (await import('./write.ts')).decideWrite(input, ctx);
  if (COMMAND_TOOLS.has(tool)) return (await import('./command.ts')).decideCommand(input, ctx);
  if (READ_TOOLS.has(tool)) return (await import('./read.ts')).decideRead(input, ctx);
  return ALLOW;
}
