/**
 * README Use Case Test Script
 * Tests the examples mentioned in the README to verify they work
 */
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

import {
  createStepRunner,
  formatError,
  resolveGodotPath,
  spawnMcpServer,
  wait,
} from './mcp_test_harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const serverEntry = path.join(repoRoot, 'build', 'index.js');

async function ensureMinimalProject(projectPath) {
  const projectGodotPath = path.join(projectPath, 'project.godot');
  try {
    await fs.access(projectGodotPath);
    return;
  } catch {
    // continue
  }

  const projectGodot = [
    '; Engine configuration file.',
    "; It's best edited using the editor, not directly.",
    'config_version=5',
    '',
    '[application]',
    'config/name="godot-mcp-readme-test"',
    '',
  ].join('\n');

  await fs.writeFile(projectGodotPath, projectGodot, 'utf8');
}

async function main() {
  console.log('=== README Use Case Test ===\n');

  try {
    await fs.access(serverEntry);
  } catch {
    throw new Error(
      `Build output not found: ${serverEntry}\nRun: npm run build`,
    );
  }

  const GODOT_PATH = await resolveGodotPath({
    exampleCommand: 'GODOT_PATH=/abs/path/to/godot npm run verify:readme',
  });

  const projectPath =
    process.env.VERIFY_PROJECT_PATH ??
    path.join(repoRoot, '.tmp', 'readme-test');
  await fs.mkdir(projectPath, { recursive: true });
  await ensureMinimalProject(projectPath);

  const { client, shutdown } = spawnMcpServer({
    serverEntry,
    env: {
      GODOT_PATH,
      ALLOW_DANGEROUS_OPS: 'true',
    },
  });

  const { runStep: runTest, results } = createStepRunner({
    onStart: (label) => console.log(`TEST: ${label}`),
    onPass: (_label, result) => {
      console.log(`  ✅ PASS`);
      if (result?.details) {
        console.log(
          `  Details: ${JSON.stringify(result.details, null, 2).slice(0, 200)}`,
        );
      }
    },
    onFail: (_label, errorMessage) => console.log(`  ❌ FAIL: ${errorMessage}`),
  });

  try {
    // Wait for server startup
    await wait(500);

    // Test 1: Get project info
    await runTest('godot_project_config_manager(project_info.get)', async () =>
      client.callToolOrThrow('godot_project_config_manager', {
        action: 'project_info.get',
        projectPath,
      }),
    );

    // Test 2: Create Player.tscn scene with CharacterBody2D root
    await runTest('create_scene (Player.tscn)', async () =>
      client.callToolOrThrow('create_scene', {
        projectPath,
        scenePath: 'scenes/Player.tscn',
        rootNodeType: 'CharacterBody2D',
      }),
    );

    // Test 3: Add Sprite2D node to Player scene
    await runTest('godot_scene_manager(create Sprite2D)', async () =>
      client.callToolOrThrow('godot_scene_manager', {
        action: 'create',
        projectPath,
        scenePath: 'scenes/Player.tscn',
        parentNodePath: 'root',
        nodeType: 'Sprite2D',
        nodeName: 'PlayerSprite',
      }),
    );

    // Test 4: Add CollisionShape2D node
    await runTest('godot_scene_manager(create CollisionShape2D)', async () =>
      client.callToolOrThrow('godot_scene_manager', {
        action: 'create',
        projectPath,
        scenePath: 'scenes/Player.tscn',
        parentNodePath: 'root',
        nodeType: 'CollisionShape2D',
        nodeName: 'Collision',
      }),
    );

    // Test 5: Create a simple PNG texture
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      'base64',
    );
    await fs.writeFile(path.join(projectPath, 'player.png'), pngBytes);
    console.log('  Created player.png texture');

    // Test 6: Load sprite texture
    await runTest('godot_asset_manager(load_texture player.png)', async () =>
      client.callToolOrThrow('godot_asset_manager', {
        action: 'load_texture',
        projectPath,
        scenePath: 'scenes/Player.tscn',
        nodePath: 'root/PlayerSprite',
        texturePath: 'res://player.png',
      }),
    );

    // Test 7: Save scene
    await runTest('godot_workspace_manager(save_scene)', async () =>
      client.callToolOrThrow('godot_workspace_manager', {
        action: 'save_scene',
        projectPath,
        scenePath: 'scenes/Player.tscn',
      }),
    );

    // Test 8: Create UI scene for main menu
    await runTest('create_scene (MainMenu.tscn)', async () =>
      client.callToolOrThrow('create_scene', {
        projectPath,
        scenePath: 'scenes/ui/MainMenu.tscn',
        rootNodeType: 'Control',
      }),
    );

    // Test 9: Add Button to UI
    await runTest('godot_scene_manager(create Button)', async () =>
      client.callToolOrThrow('godot_scene_manager', {
        action: 'create',
        projectPath,
        scenePath: 'scenes/ui/MainMenu.tscn',
        parentNodePath: 'root',
        nodeType: 'Button',
        nodeName: 'StartButton',
        props: { text: 'Start Game' },
      }),
    );

    // Test 10: Add Label to UI
    await runTest('godot_scene_manager(create Label)', async () =>
      client.callToolOrThrow('godot_scene_manager', {
        action: 'create',
        projectPath,
        scenePath: 'scenes/ui/MainMenu.tscn',
        parentNodePath: 'root',
        nodeType: 'Label',
        nodeName: 'TitleLabel',
        props: { text: 'My Game' },
      }),
    );

    // Test 11: Create a simple 3D scene
    await runTest('create_scene (MeshScene.tscn)', async () =>
      client.callToolOrThrow('create_scene', {
        projectPath,
        scenePath: 'scenes/3d/MeshScene.tscn',
        rootNodeType: 'Node3D',
      }),
    );

    // Test 12: Add MeshInstance3D
    await runTest('godot_scene_manager(create MeshInstance3D)', async () =>
      client.callToolOrThrow('godot_scene_manager', {
        action: 'create',
        projectPath,
        scenePath: 'scenes/3d/MeshScene.tscn',
        parentNodePath: 'root',
        nodeType: 'MeshInstance3D',
        nodeName: 'Cube',
      }),
    );

    // Test 13: Write a mesh scene with actual mesh data
    const meshSceneContent = `[gd_scene load_steps=2 format=3]

[sub_resource type="BoxMesh" id=1]

[node name="Root" type="Node3D"]
[node name="Cube" type="MeshInstance3D" parent="."]
mesh = SubResource(1)
`;
    await runTest('godot_headless_op (write_mesh_scene)', async () =>
      client.callToolOrThrow('godot_headless_op', {
        projectPath,
        operation: 'write_text_file',
        params: { path: 'scenes/3d/BoxScene.tscn', content: meshSceneContent },
      }),
    );

    // Test 15: Create GDScript
    await runTest('godot_headless_op (create_script)', async () =>
      client.callToolOrThrow('godot_headless_op', {
        projectPath,
        operation: 'create_script',
        params: {
          scriptPath: 'scripts/player.gd',
          extends: 'CharacterBody2D',
          template: 'minimal',
        },
      }),
    );

    // Test 16: Get project info after all changes
    await runTest(
      'godot_project_config_manager(project_info.get final)',
      async () =>
        client.callToolOrThrow('godot_project_config_manager', {
          action: 'project_info.get',
          projectPath,
        }),
    );
  } finally {
    await shutdown();
  }

  // Summary
  console.log('\n=== Summary ===');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`Passed: ${passed}, Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results
      .filter((r) => !r.ok)
      .forEach((r) => {
        console.log(`  - ${r.label}: ${r.error}`);
      });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(formatError(err));
  process.exit(1);
});
