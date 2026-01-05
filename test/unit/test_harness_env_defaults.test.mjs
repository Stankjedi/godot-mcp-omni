import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  startServer,
  waitForServerReady,
  writeMinimalProject,
} from '../helpers.mjs';

import { JsonRpcProcessClient } from '../../build/utils/jsonrpc_process_client.js';

test('startServer forces safe defaults even if process.env is unsafe (CI-safe)', async () => {
  const prevDangerous = process.env.ALLOW_DANGEROUS_OPS;
  process.env.ALLOW_DANGEROUS_OPS = 'true';

  const projectPath = mkdtemp('godot-mcp-omni-env-defaults-');
  writeMinimalProject(projectPath);

  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerReady(client);

    const dangerousBlocked = await client.callTool(
      'godot_project_config_manager',
      {
        action: 'project_setting.set',
        projectPath,
        key: 'application/config/name',
        value: 'TestProject',
      },
    );
    assert.equal(dangerousBlocked.ok, false);
    assert.match(dangerousBlocked.summary, /Dangerous operation blocked/iu);
  } finally {
    client.dispose();
    server.kill();

    if (prevDangerous === undefined) {
      delete process.env.ALLOW_DANGEROUS_OPS;
    } else {
      process.env.ALLOW_DANGEROUS_OPS = prevDangerous;
    }
  }
});
