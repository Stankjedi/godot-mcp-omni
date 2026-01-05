import assert from 'node:assert/strict';
import test from 'node:test';

import { ALL_TOOL_DEFINITIONS } from '../../build/tools/definitions/all_tools.js';
import { JsonRpcProcessClient } from '../../build/utils/jsonrpc_process_client.js';

import { startServer, waitForServerReady } from '../helpers.mjs';

test('tool definitions and handler registrations stay in sync (CI-safe)', async () => {
  const server = startServer({
    GODOT_PATH: '',
    ALLOW_DANGEROUS_OPS: 'false',
    ALLOW_EXTERNAL_TOOLS: 'false',
  });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerReady(client);

    const missing = new Set();

    for (const def of ALL_TOOL_DEFINITIONS) {
      const resp = await client.callTool(def.name, {}, 5000);
      if (resp.summary.includes('Unknown tool:')) missing.add(def.name);
    }

    assert.deepEqual(
      [...missing].sort((a, b) => a.localeCompare(b)),
      [],
      `Tool definitions exist, but runtime handlers are missing:\n- ${[...missing].sort((a, b) => a.localeCompare(b)).join('\n- ')}`,
    );
  } finally {
    client.dispose();
    server.kill();
  }
});
