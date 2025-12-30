import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';
import { startServer, waitForServerStartup } from './helpers.mjs';

test('godot_scene_manager create requires nodeType + nodeName (CI-safe)', async () => {
  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('godot_scene_manager', {
      action: 'create',
    });
    assert.equal(resp.ok, false);
    assert.match(
      String(resp.summary ?? ''),
      /create requires nodeType and nodeName/u,
    );
    assert.ok(Array.isArray(resp.details?.required));
    assert.ok(resp.details.required.includes('nodeType'));
    assert.ok(resp.details.required.includes('nodeName'));
  } finally {
    client.dispose();
    server.kill();
  }
});

test('godot_scene_manager create normalizes common aliases (CI-safe)', async () => {
  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('godot_scene_manager', {
      action: 'create',
      type: 'Node2D',
      name: 'Player',
    });
    assert.equal(resp.ok, false);
    assert.match(
      String(resp.summary ?? ''),
      /create requires projectPath and scenePath for headless mode/u,
    );
    assert.ok(Array.isArray(resp.details?.required));
    assert.ok(resp.details.required.includes('projectPath'));
    assert.ok(resp.details.required.includes('scenePath'));
  } finally {
    client.dispose();
    server.kill();
  }
});
