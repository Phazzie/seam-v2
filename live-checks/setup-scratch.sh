#!/usr/bin/env bash
# Builds the git-ignored folder live-checks/scratch/ that the live checks run in. Safe to run again.
#   - README.md        the file the builder reads
#   - mcp-ping.mjs     throwaway local MCP server with one tool, ping (check f)
#   - mcp-config.json  --mcp-config file for it (server name seam-probe-mcp, absolute path filled in here)
#   - vitest-app/      one-test project with vitest installed (check j; needs network for npm)
#   - probe-plugin-d/  copy of the probe plugin with "timeout": 5 on every hook (check d)
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
abs() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }
scratch="$here/scratch"
mkdir -p "$scratch" "$here/out"

cat > "$scratch/README.md" <<'EOT'
# Scratch project

This is a throwaway folder for hook live checks. It has no real content.
EOT

cat > "$scratch/mcp-ping.mjs" <<'EOT'
// Throwaway local MCP server (stdio, newline-delimited JSON-RPC) with one tool: ping. Used only for check f.
import { createInterface } from 'node:readline';
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'probe-ping', version: '0.0.1' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'ping', description: 'Returns the word pong. Harmless.', inputSchema: { type: 'object', properties: {} } }] } });
  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'pong' }] } });
  else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
});
EOT

scratch_abs="$(abs "$scratch")"
cat > "$scratch/mcp-config.json" <<EOT
{ "mcpServers": { "seam-probe-mcp": { "command": "node", "args": ["$scratch_abs/mcp-ping.mjs"] } } }
EOT

mkdir -p "$scratch/vitest-app"
if [ ! -f "$scratch/vitest-app/package.json" ]; then   # npm adds the vitest dependency to it, so never overwrite
  cat > "$scratch/vitest-app/package.json" <<'EOT'
{ "name": "vitest-timing", "private": true, "type": "module" }
EOT
fi
cat > "$scratch/vitest-app/a.test.ts" <<'EOT'
import { expect, test } from 'vitest';
test('adds', () => { expect(1 + 1).toBe(2); });
EOT
if [ ! -d "$scratch/vitest-app/node_modules/vitest" ]; then
  (cd "$scratch/vitest-app" && npm install vitest@5.1.2 --no-audit --no-fund)
fi

rm -rf "$scratch/probe-plugin-d"
cp -r "$here/probe-plugin" "$scratch/probe-plugin-d"
node -e '
const fs = require("fs");
const p = process.argv[1] + "/hooks/hooks.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
for (const groups of Object.values(j.hooks)) for (const g of groups) for (const h of g.hooks) h.timeout = 5;
fs.writeFileSync(p, JSON.stringify(j, null, 2));
' "$scratch/probe-plugin-d"

echo "scratch ready: $scratch_abs"
