import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import { startServer, waitForServerReady } from '../helpers.mjs';

function toolFromListResult(result, toolName) {
  const tools = result && typeof result === 'object' ? result.tools : undefined;
  if (!Array.isArray(tools)) return null;
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    if (tool.name === toolName) return tool;
  }
  return null;
}

test('godot_editor_view_manager includes panel.find/panel.read and rejects when not connected (CI-safe)', async () => {
  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerReady(client);

    const listResp = await client.send('tools/list', {});
    if ('error' in listResp) {
      throw new Error(`tools/list error: ${JSON.stringify(listResp.error)}`);
    }

    const tool = toolFromListResult(
      listResp.result,
      'godot_editor_view_manager',
    );
    assert.ok(tool, 'Missing tool object: godot_editor_view_manager');

    const action = tool.inputSchema?.properties?.action;
    assert.ok(
      action && typeof action === 'object' && !Array.isArray(action),
      'godot_editor_view_manager schema must include action',
    );

    const enumValues = action.enum;
    assert.ok(Array.isArray(enumValues), 'action.enum must be an array');
    assert.ok(enumValues.includes('panel.find'), 'Missing action: panel.find');
    assert.ok(enumValues.includes('panel.read'), 'Missing action: panel.read');

    const findResp = await client.callTool('godot_editor_view_manager', {
      action: 'panel.find',
    });
    assert.equal(findResp.ok, false);
    assert.match(findResp.summary, /requires an editor bridge connection/iu);

    const readResp = await client.callTool('godot_editor_view_manager', {
      action: 'panel.read',
      panelPath: '.',
    });
    assert.equal(readResp.ok, false);
    assert.match(readResp.summary, /requires an editor bridge connection/iu);
  } finally {
    client.dispose();
    server.kill();
  }
});
