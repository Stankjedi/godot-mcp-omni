import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import { startServer, waitForServerReady } from '../helpers.mjs';

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

test('Pixel pipeline manager tools are registered (no pixel_* legacy tools)', async () => {
  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerReady(client);
    const resp = await client.send('tools/list', {});
    if ('error' in resp) {
      throw new Error(`tools/list error: ${JSON.stringify(resp.error)}`);
    }

    const names = toolNamesFromListResult(resp.result);
    for (const required of ['pixel_manager', 'workflow_manager']) {
      assert.ok(names.includes(required), `Missing tool: ${required}`);
    }

    for (const removed of [
      'pixel_project_analyze',
      'pixel_goal_to_spec',
      'pixel_tilemap_generate',
      'pixel_world_generate',
      'pixel_layer_ensure',
      'pixel_object_generate',
      'pixel_object_place',
      'pixel_export_preview',
      'pixel_smoke_test',
      'pixel_macro_run',
      'pixel_manifest_get',
    ]) {
      assert.ok(!names.includes(removed), `Unexpected legacy tool: ${removed}`);
    }

    const workflowManager = toolFromListResult(resp.result, 'workflow_manager');
    assert.ok(workflowManager, 'Missing tool object: workflow_manager');
    const workflowProps = workflowManager.inputSchema.properties;
    assert.ok(
      workflowProps &&
        typeof workflowProps === 'object' &&
        !Array.isArray(workflowProps) &&
        workflowProps.action &&
        typeof workflowProps.action === 'object' &&
        Array.isArray(workflowProps.action.enum) &&
        workflowProps.action.enum.includes('macro.run'),
      'workflow_manager action enum must include macro.run',
    );

    const pixelManager = toolFromListResult(resp.result, 'pixel_manager');
    assert.ok(pixelManager, 'Missing tool object: pixel_manager');
    assert.ok(
      pixelManager.inputSchema &&
        typeof pixelManager.inputSchema === 'object' &&
        !Array.isArray(pixelManager.inputSchema),
      'pixel_manager.inputSchema is missing or invalid',
    );
    const properties = pixelManager.inputSchema.properties;
    assert.ok(
      properties &&
        typeof properties === 'object' &&
        !Array.isArray(properties) &&
        Object.prototype.hasOwnProperty.call(properties, 'waitMs'),
      'pixel_manager schema must include waitMs',
    );
    assert.ok(
      properties &&
        typeof properties === 'object' &&
        !Array.isArray(properties) &&
        Object.prototype.hasOwnProperty.call(properties, 'imageGenMode'),
      'pixel_manager schema must include imageGenMode',
    );
  } finally {
    client.dispose();
    server.kill();
  }
});
