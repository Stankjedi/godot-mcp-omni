import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import { startServer, waitForServerStartup } from '../helpers.mjs';

function toolNamesFromListResult(result) {
  const tools = result && typeof result === 'object' ? result.tools : undefined;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => (t && typeof t === 'object' ? t.name : undefined))
    .filter((n) => typeof n === 'string');
}

function toolFromListResult(result, toolName) {
  const tools = result && typeof result === 'object' ? result.tools : undefined;
  if (!Array.isArray(tools)) return null;
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    if (tool.name === toolName) return tool;
  }
  return null;
}

test('godot_log_manager is registered and rejects when not connected (CI-safe)', async () => {
  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();

    const listResp = await client.send('tools/list', {});
    if ('error' in listResp) {
      throw new Error(`tools/list error: ${JSON.stringify(listResp.error)}`);
    }

    const names = toolNamesFromListResult(listResp.result);
    assert.ok(
      names.includes('godot_log_manager'),
      'Missing tool: godot_log_manager',
    );

    const tool = toolFromListResult(listResp.result, 'godot_log_manager');
    assert.ok(tool, 'Missing tool object: godot_log_manager');
    assert.ok(
      tool.inputSchema &&
        typeof tool.inputSchema === 'object' &&
        !Array.isArray(tool.inputSchema),
      'godot_log_manager.inputSchema is missing or invalid',
    );
    const properties = tool.inputSchema.properties;
    assert.ok(
      properties &&
        typeof properties === 'object' &&
        !Array.isArray(properties) &&
        Object.prototype.hasOwnProperty.call(properties, 'action'),
      'godot_log_manager schema must include action',
    );

    const resp = await client.callTool('godot_log_manager', { action: 'poll' });
    assert.equal(resp.ok, false);
    assert.match(resp.summary, /requires an editor bridge connection/iu);
    assert.ok(Array.isArray(resp.details?.suggestions));
  } finally {
    client.dispose();
    server.kill();
  }
});
