import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import { startServer, waitForServerReady } from '../helpers.mjs';

test('meta_tool_manager server_info works (CI-safe)', async () => {
  const server = startServer({
    GODOT_PATH: '',
    ALLOW_DANGEROUS_OPS: 'false',
    ALLOW_EXTERNAL_TOOLS: 'false',
  });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerReady(client);

    const info = await client.callToolOrThrow('meta_tool_manager', {
      action: 'server_info',
    });

    const details = info.details;
    assert.ok(details && typeof details === 'object');

    const tools = details.tools;
    assert.ok(tools && typeof tools === 'object');
    assert.ok(Array.isArray(tools.names));
    assert.ok(tools.names.includes('meta_tool_manager'));
  } finally {
    client.dispose();
    server.kill();
  }
});

test('meta_tool_manager tool_help forwards toolAction', async () => {
  const server = startServer({
    GODOT_PATH: '',
    ALLOW_DANGEROUS_OPS: 'false',
    ALLOW_EXTERNAL_TOOLS: 'false',
  });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerReady(client);

    const help = await client.callToolOrThrow('meta_tool_manager', {
      action: 'tool_help',
      tool: 'godot_workspace_manager',
      toolAction: 'status',
    });

    assert.equal(help.ok, true);
    assert.equal(help.summary, 'Tool help');
    assert.equal(help.details.tool, 'godot_workspace_manager');
    assert.equal(help.details.action, 'status');
  } finally {
    client.dispose();
    server.kill();
  }
});
