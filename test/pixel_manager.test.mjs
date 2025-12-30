import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';
import {
  mkdtemp,
  startServer,
  waitForServerStartup,
  writeMinimalProject,
} from './helpers.mjs';

test('pixel_manager forwards goal_to_spec to pixel_goal_to_spec', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-pixel-manager-');
  writeMinimalProject(projectPath, 'PixelManagerTest');

  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();

    const resp = await client.callTool('pixel_manager', {
      action: 'goal_to_spec',
      projectPath,
      goal: 'tilemap + world (size 16x16)',
    });

    assert.equal(resp.ok, true);
    assert.equal(resp.summary, 'Goal converted to pixel specs');
    assert.ok(resp.details && typeof resp.details === 'object');
    assert.ok(Array.isArray(resp.details.plan));
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});
