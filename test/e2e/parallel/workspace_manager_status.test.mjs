import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import { startServer, waitForServerReady } from '../helpers.mjs';

test('godot_workspace_manager status returns connection state (CI-safe)', async () => {
  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerReady(client);
    const resp = await client.callTool('godot_workspace_manager', {
      action: 'status',
    });
    assert.equal(resp.ok, true);
    assert.equal(typeof resp.details?.connected, 'boolean');

    const editorProjectPath = resp.details?.editorProjectPath;
    assert.ok(
      editorProjectPath === null || typeof editorProjectPath === 'string',
    );

    const godotPath = resp.details?.godotPath;
    assert.ok(godotPath === null || typeof godotPath === 'string');

    const suggestions = resp.details?.suggestions;
    assert.ok(Array.isArray(suggestions));
    assert.ok(suggestions.every((s) => typeof s === 'string'));
  } finally {
    client.dispose();
    server.kill();
  }
});
