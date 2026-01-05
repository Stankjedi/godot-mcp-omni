import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import { startServer, waitForServerReady } from '../helpers.mjs';

test('meta_tool_manager server_info returns server metadata (CI-safe)', async () => {
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

    const serverInfo = details.server;
    assert.ok(serverInfo && typeof serverInfo === 'object');
    assert.equal(typeof serverInfo.name, 'string');
    assert.ok(serverInfo.name.length > 0);
    assert.equal(typeof serverInfo.version, 'string');
    assert.ok(serverInfo.version.length > 0);

    const safety = details.safety;
    assert.ok(safety && typeof safety === 'object');
    assert.equal(safety.allowDangerousOps, false);
    assert.equal(safety.allowExternalTools, false);

    const editorBridge = details.editorBridge;
    assert.ok(editorBridge && typeof editorBridge === 'object');
    assert.equal(editorBridge.connected, false);

    const godot = details.godot;
    assert.ok(godot && typeof godot === 'object');
    assert.equal(godot.configured, false);

    const tools = details.tools;
    assert.ok(tools && typeof tools === 'object');
    assert.equal(typeof tools.count, 'number');
    assert.ok(tools.count > 0);

    const groups = tools.groups;
    assert.ok(groups && typeof groups === 'object' && !Array.isArray(groups));
    const groupEntries = Object.entries(groups);
    assert.ok(groupEntries.length > 0);
    for (const [groupName, groupCount] of groupEntries) {
      assert.equal(typeof groupName, 'string');
      assert.equal(typeof groupCount, 'number');
      assert.ok(Number.isFinite(groupCount));
      assert.ok(groupCount >= 0);
    }
    const sum = groupEntries.reduce((acc, [, n]) => acc + n, 0);
    assert.equal(sum, tools.count);

    const names = tools.names;
    assert.ok(Array.isArray(names));
    assert.ok(names.length > 0);
    assert.deepEqual([...names].sort(), names);
  } finally {
    client.dispose();
    server.kill();
  }
});
