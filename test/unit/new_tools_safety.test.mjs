import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  mkdtemp,
  resolveResPath,
  startServer,
  waitForServerReady,
  writeMinimalProject,
} from '../helpers.mjs';

import { JsonRpcProcessClient } from '../../build/utils/jsonrpc_process_client.js';

test('new tool managers enforce guardrails (CI-safe)', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-new-tools-');
  writeMinimalProject(projectPath);

  const server = startServer({
    GODOT_PATH: '',
    ALLOW_DANGEROUS_OPS: 'false',
    ALLOW_EXTERNAL_TOOLS: 'false',
  });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerReady(client);

    const createOk = await client.callTool('godot_code_manager', {
      action: 'script.create',
      projectPath,
      scriptPath: 'res://scripts/Test.gd',
    });
    assert.equal(createOk.ok, true);

    const absScriptPath = resolveResPath(projectPath, 'res://scripts/Test.gd');
    assert.ok(absScriptPath);
    assert.ok(fs.existsSync(absScriptPath));
    const original = fs.readFileSync(absScriptPath, 'utf8');

    const overwriteBlocked = await client.callTool('godot_code_manager', {
      action: 'script.create',
      projectPath,
      scriptPath: 'res://scripts/Test.gd',
      content: `${original}\n# overwrite test\n`,
    });
    assert.equal(overwriteBlocked.ok, false);
    assert.equal(overwriteBlocked.error?.code, 'E_PERMISSION_DENIED');

    const userPathBlocked = await client.callTool('godot_code_manager', {
      action: 'script.create',
      projectPath,
      scriptPath: 'user://hack.gd',
      content: 'extends Node\n',
    });
    assert.equal(userPathBlocked.ok, false);
    assert.match(
      userPathBlocked.summary,
      /Disallowed path scheme \(user:\/\/\)/u,
    );

    const builderNotConnected = await client.callTool('godot_builder_manager', {
      action: 'set_anchor_preset',
      projectPath,
      nodePath: 'root',
      anchorPreset: 'full_rect',
    });
    assert.equal(builderNotConnected.ok, false);
    assert.match(
      builderNotConnected.summary,
      /requires an editor bridge connection/iu,
    );

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
  }
});
