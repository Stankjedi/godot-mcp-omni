import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import { startServer, waitForServerStartup } from '../helpers.mjs';

test('workflow_manager runs a minimal workflow (CI-safe)', async () => {
  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();

    const workflow = {
      schemaVersion: 1,
      steps: [
        {
          id: 'WF-001',
          title: 'List tools',
          tool: 'tools/list',
          args: {},
        },
      ],
    };

    const resp = await client.callTool('workflow_manager', {
      action: 'run',
      workflow,
    });

    assert.equal(resp.ok, true, resp.summary);
    assert.ok(resp.details && typeof resp.details === 'object');
    assert.ok(
      Array.isArray(resp.details.steps),
      'details.steps must be an array',
    );
    assert.equal(resp.details.steps.length, 1);
    assert.equal(resp.details.steps[0].tool, 'tools/list');
    assert.equal(resp.details.steps[0].actualOk, true);
  } finally {
    client.dispose();
    server.kill();
  }
});
