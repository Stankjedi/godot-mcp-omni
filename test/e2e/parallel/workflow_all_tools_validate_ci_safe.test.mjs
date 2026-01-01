import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import { startServer, waitForServerStartup } from '../helpers.mjs';

test('workflow_manager validates the all-tools workflow JSON (CI-safe)', async () => {
  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();

    const resp = await client.callTool('workflow_manager', {
      action: 'validate',
      workflowPath: 'scripts/workflow_all_tools_solar_system.json',
    });

    assert.equal(resp.ok, true, resp.summary);
    assert.ok(resp.details && typeof resp.details === 'object');
    assert.ok(
      resp.details.workflow && typeof resp.details.workflow === 'object',
    );
    assert.equal(resp.details.workflow.schemaVersion, 1);
    assert.ok(
      Array.isArray(resp.details.workflow.steps),
      'details.workflow.steps must be an array',
    );
    assert.ok(resp.details.workflow.steps.length > 0);
  } finally {
    client.dispose();
    server.kill();
  }
});
