// Probe hook for live checks. Appends one JSON line per hook call to live-checks/out/hook-log.jsonl.
// Behavior is chosen by env vars:
//   PROBE_MODE=crash       throw after logging (check c)
//   PROBE_MODE=sleep       sleep 120 s after logging (check d)
//   PROBE_MODE=deny-read   deny Read when agent_type contains "builder" (check i)
//   PROBE_MODE=block-stop  SubagentStop returns decision:block each time, up to PROBE_BLOCK_LIMIT (default 20) (check k)
//   PROBE_MODE=block-stop-exit2  same, but blocks with exit code 2 and the reason on stderr (check k, variant)
//   PROBE_MODE=vitest      on every PreToolUse, time `npx vitest run` in PROBE_VITEST_DIR (check j)
//   PROBE_OUT              override the log path
//   PROBE_RUN              label copied into every log line, to tell runs apart
// It never throws, except in crash mode.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = process.env.PROBE_OUT ?? resolve(here, '..', 'out', 'hook-log.jsonl');
const mode = process.env.PROBE_MODE ?? '';

function log(entry) {
  try {
    mkdirSync(dirname(outFile), { recursive: true });
    appendFileSync(outFile, JSON.stringify({ ts: new Date().toISOString(), run: process.env.PROBE_RUN ?? null, pid: process.pid, mode, ...entry }) + '\n');
  } catch (e) {
    process.stderr.write(`probe: could not write log: ${e.message}\n`);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function countLogged(match) {
  if (!existsSync(outFile)) return 0;
  return readFileSync(outFile, 'utf8').split('\n').filter((line) => line && match(line)).length;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  const raw = await readStdin();
  let input = null;
  try { input = JSON.parse(raw); } catch (e) { input = { parse_error: e.message }; }
  const event = input?.hook_event_name ?? null;
  const dataDir = process.env.CLAUDE_PLUGIN_DATA ?? null;
  log({
    phase: 'received',
    event,
    CLAUDE_PLUGIN_DATA: dataDir,
    CLAUDE_PLUGIN_DATA_exists: dataDir ? existsSync(dataDir) : null,
    CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT ?? null,
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR ?? null,
    claude_env_names: Object.keys(process.env).filter((k) => k.startsWith('CLAUDE')).sort(),
    raw,
    input,
  });

  if (mode === 'sleep') {
    log({ phase: 'sleep-start', event });
    await sleep(120_000);
    log({ phase: 'sleep-end', event });
  }

  if (mode === 'deny-read' && event === 'PreToolUse' && input.tool_name === 'Read' && String(input.agent_type ?? '').includes('builder')) {
    log({ phase: 'deny', event, agent_type: input.agent_type });
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'PROBE-DENY-123: the probe plugin does not let builder agents read files.',
      },
    }));
  }

  if (mode === 'block-stop' && event === 'SubagentStop') {
    const limit = Number(process.env.PROBE_BLOCK_LIMIT ?? 20);
    const id = input.agent_id;
    const seen = countLogged((line) => line.includes('"phase":"block"') && line.includes(`"agent_id":"${id}"`));
    if (seen < limit) {
      log({ phase: 'block', event, agent_id: id, n: seen + 1, stop_hook_active: input.stop_hook_active ?? null });
      process.stdout.write(JSON.stringify({ decision: 'block', reason: `PROBE forced continue ${seen + 1}: reply with the single word "again".` }));
    } else {
      log({ phase: 'limit-release', event, agent_id: id, n: seen });
    }
  }

  if (mode === 'block-stop-exit2' && event === 'SubagentStop') {
    log({ phase: 'block-exit2', event, agent_id: input.agent_id });
    process.stderr.write('PROBE exit-2 forced continue: reply with the single word "again".');
    process.exitCode = 2;
  }

  if (mode === 'vitest' && event === 'PreToolUse' && process.env.PROBE_VITEST_DIR) {
    const started = process.hrtime.bigint();
    const run = spawnSync('npx', ['vitest', 'run'], { cwd: process.env.PROBE_VITEST_DIR, shell: true, encoding: 'utf8', timeout: 110_000 });
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    log({ phase: 'vitest', event, seconds, status: run.status, signal: run.signal, error: run.error ? String(run.error) : null, stdout_tail: (run.stdout ?? '').slice(-600), stderr_tail: (run.stderr ?? '').slice(-300) });
  }
}

try {
  await main();
} catch (e) {
  log({ phase: 'probe-internal-error', error: String(e), stack: e?.stack ?? null });
}

if (mode === 'crash') {
  log({ phase: 'crashing-now' });
  throw new Error('PROBE_MODE=crash: deliberate crash');
}
