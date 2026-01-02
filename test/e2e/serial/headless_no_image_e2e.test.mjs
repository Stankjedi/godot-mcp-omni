import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { writePngRgba } from '../../../build/pipeline/png.js';
import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import {
  mkdtemp,
  resolveResPath,
  startServer,
  waitForServerStartup,
  writeMinimalProject,
} from '../helpers.mjs';

async function rmRecursiveWithRetry(targetPath, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : undefined;
      if (code !== 'EACCES' && code !== 'EPERM') throw error;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // Best-effort: leave the temp dir behind if Windows is still holding locks.
}

async function writeAtlasPng(projectPath, resPath, tileSize, columns, rows) {
  const absPath = resolveResPath(projectPath, resPath);
  assert.ok(absPath, `Invalid res path: ${resPath}`);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  const width = tileSize * columns;
  const height = tileSize * rows;

  const palette = [
    [0, 200, 0, 255], // grass
    [0, 120, 0, 255], // forest
    [0, 0, 200, 255], // water
    [150, 75, 0, 255], // path
    [120, 120, 120, 255], // cliff
    [200, 200, 0, 255],
    [200, 0, 200, 255],
    [0, 200, 200, 255],
  ];

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const tileY = Math.floor(y / tileSize);
    for (let x = 0; x < width; x += 1) {
      const tileX = Math.floor(x / tileSize);
      const color = palette[(tileX + tileY * columns) % palette.length];
      const idx = (y * width + x) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = color[3];
    }
  }

  await writePngRgba(absPath, width, height, rgba);
}

function writePixelMeta(projectPath, tilesetPath, meta) {
  const metaPath = tilesetPath.replace(/\.tres$/u, '.json');
  const absMeta = resolveResPath(projectPath, metaPath);
  assert.ok(absMeta, `Invalid res path: ${metaPath}`);
  fs.mkdirSync(path.dirname(absMeta), { recursive: true });
  fs.writeFileSync(absMeta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return metaPath;
}

function writePixelManifest(projectPath, manifest) {
  const abs = path.join(projectPath, '.godot_mcp', 'pixel_manifest.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

test(
  'headless tools smoke (no image-generation features)',
  { skip: !process.env.GODOT_PATH },
  async () => {
    const projectPath = mkdtemp('godot-mcp-omni-headless-noimg-');
    const mainScene = 'res://scenes/Main.tscn';
    const atlasPng = 'res://assets/generated/fixtures/headless_atlas.png';

    writeMinimalProject(projectPath, 'HeadlessNoImageE2E', mainScene);

    const server = startServer();
    const client = new JsonRpcProcessClient(server);

    try {
      await waitForServerStartup();

      const versionTool = await client.callToolOrThrow('get_godot_version', {});
      assert.equal(versionTool.ok, true);
      assert.ok(versionTool.details && typeof versionTool.details === 'object');
      assert.equal(typeof versionTool.details.version, 'string');

      const preflight = await client.callToolOrThrow('godot_preflight', {
        projectPath,
      });
      assert.equal(preflight.ok, true);
      assert.equal(preflight.details?.checks?.project?.status, 'ok');
      assert.equal(preflight.details?.checks?.godot?.status, 'ok');

      // Prepare assets (fixture PNG) without using any image-generation tools.
      await writeAtlasPng(projectPath, atlasPng, 16, 8, 2);

      // Create a scene and exercise headless scene tooling.
      await client.callToolOrThrow('godot_headless_op', {
        projectPath,
        operation: 'create_scene',
        params: { scenePath: mainScene, rootNodeType: 'Node2D' },
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'create',
        projectPath,
        scenePath: mainScene,
        nodeType: 'Sprite2D',
        nodeName: 'Sprite',
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'create',
        projectPath,
        scenePath: mainScene,
        nodeType: 'Timer',
        nodeName: 'Timer',
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'create',
        projectPath,
        scenePath: mainScene,
        nodeType: 'Node',
        nodeName: 'Receiver',
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'update',
        projectPath,
        scenePath: mainScene,
        nodePath: 'root/Timer',
        props: { wait_time: 0.05, one_shot: false, autostart: true },
      });

      await client.callToolOrThrow('godot_headless_batch', {
        projectPath,
        steps: [
          {
            operation: 'write_text_file',
            params: {
              path: 'res://scripts/Receiver.gd',
              content: 'extends Node\nfunc _on_timeout() -> void:\n\tpass\n',
            },
          },
          {
            operation: 'read_text_file',
            params: { path: 'res://scripts/Receiver.gd' },
          },
        ],
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'attach_script',
        projectPath,
        scenePath: mainScene,
        nodePath: 'root/Receiver',
        scriptPath: 'res://scripts/Receiver.gd',
      });

      await client.callToolOrThrow('godot_inspector_manager', {
        action: 'connect_signal',
        projectPath,
        scenePath: mainScene,
        fromNodePath: 'root/Timer',
        signal: 'timeout',
        toNodePath: 'root/Receiver',
        method: '_on_timeout',
      });

      // Unified Asset Manager headless fallbacks.
      const uidResp = await client.callToolOrThrow('godot_asset_manager', {
        action: 'get_uid',
        projectPath,
        filePath: 'res://scripts/Receiver.gd',
      });
      assert.equal(uidResp.ok, true);
      assert.equal(typeof uidResp.details?.uid, 'string');
      const uidFile = path.join(projectPath, 'scripts', 'Receiver.gd.uid');
      assert.ok(fs.existsSync(uidFile), 'UID file was not created');

      const scanResp = await client.callToolOrThrow('godot_asset_manager', {
        action: 'scan',
        projectPath,
      });
      assert.equal(scanResp.ok, true);

      const autoImportResp = await client.callToolOrThrow(
        'godot_asset_manager',
        {
          action: 'auto_import_check',
          projectPath,
        },
      );
      assert.equal(autoImportResp.ok, true);

      const loadTextureResp = await client.callToolOrThrow(
        'godot_asset_manager',
        {
          action: 'load_texture',
          projectPath,
          scenePath: mainScene,
          nodePath: 'root/Sprite',
          texturePath: atlasPng,
        },
      );
      assert.equal(loadTextureResp.ok, true);

      // Create a TileMap via scene manager (headless op create_tilemap).
      const tileSetOut =
        'res://assets/generated/fixtures/headless_tileset.tres';
      const tilemapResp = await client.callToolOrThrow('godot_scene_manager', {
        action: 'create_tilemap',
        projectPath,
        scenePath: mainScene,
        nodeName: 'TileMap',
        tileSetTexturePath: atlasPng,
        tileSetPath: tileSetOut,
        tileSize: 16,
      });
      assert.equal(tilemapResp.ok, true);

      // Pixel pipeline headless world generation WITHOUT image generation (uses existing atlas).
      const pixelTilesetName = 'headless_tiles';
      const pixelTilesetPath = `res://assets/generated/tilesets/${pixelTilesetName}/${pixelTilesetName}.tres`;
      const pixelAtlasPath = `res://assets/generated/tilesets/${pixelTilesetName}/${pixelTilesetName}.png`;
      await writeAtlasPng(projectPath, pixelAtlasPath, 16, 8, 2);

      const metaJsonPath = writePixelMeta(projectPath, pixelTilesetPath, {
        schemaVersion: 1,
        tileSize: 16,
        sheet: { columns: 8, rows: 2 },
        tiles: {
          grass: { atlas: { x: 0, y: 0 } },
          forest: { atlas: { x: 1, y: 0 } },
          water: { atlas: { x: 2, y: 0 } },
          path: { atlas: { x: 3, y: 0 } },
          cliff: { atlas: { x: 4, y: 0 } },
        },
      });

      writePixelManifest(projectPath, {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        projectPath,
        steps: [],
        outputs: {
          tileset: {
            sheetPngPath: pixelAtlasPath,
            tilesetPath: pixelTilesetPath,
            metaJsonPath,
          },
        },
      });

      await client.callToolOrThrow('godot_headless_op', {
        projectPath,
        operation: 'op_tileset_create_from_atlas',
        params: {
          pngPath: pixelAtlasPath,
          tileSize: 16,
          outputTilesetPath: pixelTilesetPath,
          allowOverwrite: false,
        },
      });

      const worldScenePath = 'res://scenes/generated/world/HeadlessWorld.tscn';
      await client.callToolOrThrow('pixel_world_generate', {
        projectPath,
        spec: {
          scenePath: worldScenePath,
          tilesetPath: pixelTilesetPath,
          mapSize: { width: 8, height: 8 },
          seed: 42,
        },
      });

      const placeResp = await client.callToolOrThrow('pixel_object_place', {
        projectPath,
        worldScenePath,
        seed: 42,
        spec: {
          objects: [
            {
              id: 'tree_1',
              kind: 'tree',
              representation: 'tile',
              placement: {
                density: 0.1,
                minDistance: 1,
                onTiles: ['grass'],
                avoidTiles: ['water'],
              },
            },
          ],
        },
      });
      assert.equal(placeResp.ok, true);

      // Pixel smoke test should start/stop the project headlessly.
      const smokeResp = await client.callToolOrThrow('pixel_manager', {
        action: 'smoke_test',
        projectPath,
        scenePath: mainScene,
        waitMs: 300,
      });
      assert.equal(smokeResp.ok, true);

      // Workspace manager headless run/stop (mode=headless should imply headless=true).
      const runResp = await client.callToolOrThrow('godot_workspace_manager', {
        action: 'run',
        mode: 'headless',
        projectPath,
        scene: mainScene,
      });
      assert.equal(runResp.ok, true);
      await new Promise((r) => setTimeout(r, 300));
      const stopResp = await client.callToolOrThrow('godot_workspace_manager', {
        action: 'stop',
        mode: 'headless',
      });
      assert.equal(stopResp.ok, true);

      // Verify dangerous ops are blocked by default.
      const exportResp = await client.callTool('godot_headless_op', {
        projectPath,
        operation: 'export_mesh_library',
        params: {
          scenePath: mainScene,
          outputPath: 'res://assets/generated/fixtures/out.tres',
        },
      });
      assert.equal(exportResp.ok, false);
      assert.match(
        String(exportResp.summary ?? ''),
        /Dangerous operation blocked/u,
      );
    } finally {
      client.dispose();
      server.kill();
      await rmRecursiveWithRetry(projectPath);
    }
  },
);

test(
  'macro_manager run with pixel plan (no image-generation steps) composes Main scene',
  { skip: !process.env.GODOT_PATH },
  async () => {
    const projectPath = mkdtemp('godot-mcp-omni-macro-noimg-');
    writeMinimalProject(projectPath, 'MacroNoImageE2E', null);

    const pixelTilesetName = 'macro_tiles';
    const pixelTilesetPath = `res://assets/generated/tilesets/${pixelTilesetName}/${pixelTilesetName}.tres`;
    const pixelAtlasPath = `res://assets/generated/tilesets/${pixelTilesetName}/${pixelTilesetName}.png`;
    await writeAtlasPng(projectPath, pixelAtlasPath, 16, 8, 2);
    const metaJsonPath = writePixelMeta(projectPath, pixelTilesetPath, {
      schemaVersion: 1,
      tileSize: 16,
      sheet: { columns: 8, rows: 2 },
      tiles: {
        grass: { atlas: { x: 0, y: 0 } },
        forest: { atlas: { x: 1, y: 0 } },
        water: { atlas: { x: 2, y: 0 } },
        path: { atlas: { x: 3, y: 0 } },
        cliff: { atlas: { x: 4, y: 0 } },
      },
    });

    writePixelManifest(projectPath, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      projectPath,
      steps: [],
      outputs: {
        tileset: {
          sheetPngPath: pixelAtlasPath,
          tilesetPath: pixelTilesetPath,
          metaJsonPath,
        },
      },
    });

    const server = startServer();
    const client = new JsonRpcProcessClient(server);

    try {
      await waitForServerStartup();

      await client.callToolOrThrow('godot_headless_op', {
        projectPath,
        operation: 'op_tileset_create_from_atlas',
        params: {
          pngPath: pixelAtlasPath,
          tileSize: 16,
          outputTilesetPath: pixelTilesetPath,
          allowOverwrite: false,
        },
      });

      const worldScenePath = 'res://scenes/generated/world/MacroWorld.tscn';
      const resp = await client.callToolOrThrow('macro_manager', {
        action: 'run',
        projectPath,
        pixel: {
          plan: [
            {
              tool: 'pixel_world_generate',
              args: {
                spec: {
                  scenePath: worldScenePath,
                  tilesetPath: pixelTilesetPath,
                  mapSize: { width: 8, height: 8 },
                  seed: 123,
                },
              },
            },
          ],
          seed: 123,
          failFast: true,
        },
        macros: [
          'input_system_scaffold',
          'character_controller_2d_scaffold',
          'camera_2d_scaffold',
        ],
        composeMainScene: true,
        validate: true,
      });

      assert.equal(resp.ok, true);

      const main = resolveResPath(
        projectPath,
        'res://scenes/generated/macro/Main.tscn',
      );
      assert.ok(main && fs.existsSync(main), 'Main scene not created');
    } finally {
      client.dispose();
      server.kill();
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  },
);
