import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';
import {
  mkdtemp,
  resolveResPath,
  startServer,
  waitForServerStartup,
  writeMinimalProject,
} from './helpers.mjs';

test('macro_manager list_macros works without projectPath', async () => {
  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('macro_manager', {
      action: 'list_macros',
    });
    assert.equal(resp.ok, true);
    assert.ok(resp.details && Array.isArray(resp.details.macros));
    const ids = resp.details.macros.map((m) => m.id);
    assert.deepEqual(ids, [
      'input_system_scaffold',
      'character_controller_2d_scaffold',
      'camera_2d_scaffold',
      'animation_pipeline_scaffold',
      'combat_hitbox_scaffold',
      'enemy_ai_fsm_scaffold',
      'level_pipeline_scaffold',
      'ui_system_scaffold',
      'save_load_scaffold',
      'audio_system_scaffold',
    ]);
  } finally {
    client.dispose();
    server.kill();
  }
});

test('macro_manager plan/run(dryRun) work without GODOT_PATH', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-macro-manager-');
  writeMinimalProject(projectPath, 'MacroManagerTest');

  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();

    const planResp = await client.callTool('macro_manager', {
      action: 'plan',
      projectPath,
      macroId: 'input_system_scaffold',
    });
    assert.equal(planResp.ok, true);
    assert.ok(planResp.details && Array.isArray(planResp.details.plans));
    assert.ok(Array.isArray(planResp.details.plans[0].operations));

    const planWithPixel = await client.callTool('macro_manager', {
      action: 'plan',
      projectPath,
      macros: [
        'input_system_scaffold',
        'character_controller_2d_scaffold',
        'camera_2d_scaffold',
      ],
      pixel: {
        goal: 'tilemap + world (size 16x16)',
        seed: 42,
      },
      composeMainScene: true,
    });
    assert.equal(planWithPixel.ok, true);
    assert.ok(planWithPixel.details && planWithPixel.details.pixel);
    assert.equal(planWithPixel.details.pixel.tool, 'pixel_manager');
    assert.ok(planWithPixel.details.composeMainScene);
    assert.ok(Array.isArray(planWithPixel.details.composeMainScene.operations));

    const dryRunResp = await client.callTool('macro_manager', {
      action: 'run',
      projectPath,
      macros: ['input_system_scaffold', 'character_controller_2d_scaffold'],
      dryRun: true,
    });
    assert.equal(dryRunResp.ok, true);
    assert.match(dryRunResp.summary, /dryRun/u);

    const dryRunWithPixel = await client.callTool('macro_manager', {
      action: 'run',
      projectPath,
      macros: [
        'input_system_scaffold',
        'character_controller_2d_scaffold',
        'camera_2d_scaffold',
      ],
      pixel: {
        goal: 'tilemap + world (size 16x16)',
        seed: 42,
      },
      composeMainScene: true,
      dryRun: true,
    });
    assert.equal(dryRunWithPixel.ok, true);
    assert.ok(dryRunWithPixel.details && dryRunWithPixel.details.pixel);
    assert.ok(dryRunWithPixel.details.composeMainScene);
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test(
  'macro_manager run creates scaffold outputs (headless)',
  { skip: !process.env.GODOT_PATH },
  async () => {
    const projectPath = mkdtemp('godot-mcp-omni-macro-manager-e2e-');
    writeMinimalProject(projectPath, 'MacroManagerE2E');

    const server = startServer();
    const client = new JsonRpcProcessClient(server);

    try {
      await waitForServerStartup();
      const resp = await client.callTool('macro_manager', {
        action: 'run',
        projectPath,
        macros: ['input_system_scaffold', 'character_controller_2d_scaffold'],
        validate: true,
      });

      assert.equal(resp.ok, true);
      const inputManager = resolveResPath(
        projectPath,
        'res://scripts/macro/input/InputManager.gd',
      );
      const playerScene = resolveResPath(
        projectPath,
        'res://scenes/generated/macro/player/Player.tscn',
      );
      assert.ok(inputManager && fs.existsSync(inputManager));
      assert.ok(playerScene && fs.existsSync(playerScene));
    } finally {
      client.dispose();
      server.kill();
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  },
);
