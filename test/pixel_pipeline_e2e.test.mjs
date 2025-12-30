import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';
import {
  mkdtemp,
  resolveResPath,
  startServer,
  waitForServerStartup,
  writeMinimalProject,
} from './helpers.mjs';

async function rmrfWithRetries(targetPath, attempts = 10) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : undefined;
      const retryable = [
        'EACCES',
        'EPERM',
        'EBUSY',
        'ENOTEMPTY',
        'EEXIST',
      ].includes(code);
      if (!retryable || i === attempts - 1) throw error;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

test(
  'pixel pipeline headless e2e macro run',
  { skip: !process.env.GODOT_PATH },
  async () => {
    const projectPath = mkdtemp('godot-mcp-omni-pixel-e2e-');
    writeMinimalProject(projectPath);

    const server = startServer();
    const client = new JsonRpcProcessClient(server);

    try {
      await waitForServerStartup();

      const plan = [
        {
          tool: 'pixel_tilemap_generate',
          args: {
            spec: {
              name: 'e2e_tiles',
              tileSize: 16,
              sheet: { columns: 8, rows: 8 },
            },
          },
        },
        {
          tool: 'pixel_world_generate',
          args: {
            spec: {
              scenePath: 'res://scenes/generated/world/E2E.tscn',
              tilesetName: 'e2e_tiles',
              mapSize: { width: 16, height: 16 },
            },
          },
        },
        {
          tool: 'pixel_object_generate',
          args: {
            spec: {
              objects: [
                {
                  id: 'tree_e2e',
                  kind: 'tree',
                  representation: 'tile',
                  sizePx: { w: 16, h: 16 },
                },
              ],
            },
          },
        },
        {
          tool: 'pixel_object_place',
          args: {
            worldScenePath: 'res://scenes/generated/world/E2E.tscn',
            spec: {
              objects: [
                {
                  id: 'tree_e2e',
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
          },
        },
      ];

      const resp = await client.callTool(
        'pixel_macro_run',
        {
          projectPath,
          plan,
          seed: 42,
          failFast: true,
        },
        120_000,
      );

      if (!resp.ok) {
        assert.match(resp.summary, /pixel_/u);
        throw new Error(`pixel_macro_run failed: ${resp.summary}`);
      }

      assert.equal(resp.ok, true);

      const manifestPath = path.join(
        projectPath,
        '.godot_mcp',
        'pixel_manifest.json',
      );
      assert.ok(fs.existsSync(manifestPath), 'manifest not found');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.equal(manifest.schemaVersion, 1);
      assert.ok(Array.isArray(manifest.steps));
      assert.ok(manifest.outputs && typeof manifest.outputs === 'object');

      const stepNames = manifest.steps
        .map((s) => (s && typeof s === 'object' ? s.name : undefined))
        .filter((n) => typeof n === 'string');
      for (const required of [
        'pixel_tilemap_generate',
        'pixel_world_generate',
        'pixel_object_generate',
        'pixel_object_place',
      ]) {
        assert.ok(stepNames.includes(required), `Missing step: ${required}`);
      }

      const tilesetPath = resolveResPath(
        projectPath,
        'res://assets/generated/tilesets/e2e_tiles/e2e_tiles.tres',
      );
      const tilesheetPath = resolveResPath(
        projectPath,
        'res://assets/generated/tilesets/e2e_tiles/e2e_tiles.png',
      );
      const worldScenePath = resolveResPath(
        projectPath,
        'res://scenes/generated/world/E2E.tscn',
      );
      assert.ok(tilesetPath && fs.existsSync(tilesetPath), 'tileset missing');
      assert.ok(
        tilesheetPath && fs.existsSync(tilesheetPath),
        'tilesheet missing',
      );
      assert.ok(
        worldScenePath && fs.existsSync(worldScenePath),
        'world scene missing',
      );
    } finally {
      client.dispose();
      server.kill();
      await rmrfWithRetries(projectPath);
    }
  },
);

test(
  'pixel pipeline headless e2e macro run with exportPreview and smokeTest',
  { skip: !process.env.GODOT_PATH },
  async () => {
    const projectPath = mkdtemp('godot-mcp-omni-pixel-e2e-preview-');
    writeMinimalProject(projectPath);

    const server = startServer();
    const client = new JsonRpcProcessClient(server);

    try {
      await waitForServerStartup();

      const plan = [
        {
          tool: 'pixel_tilemap_generate',
          args: {
            spec: {
              name: 'e2e_preview_tiles',
              tileSize: 16,
              sheet: { columns: 4, rows: 4 },
            },
          },
        },
        {
          tool: 'pixel_world_generate',
          args: {
            spec: {
              scenePath: 'res://scenes/generated/world/PreviewTest.tscn',
              tilesetName: 'e2e_preview_tiles',
              mapSize: { width: 8, height: 8 },
            },
          },
        },
      ];

      const resp = await client.callTool(
        'pixel_macro_run',
        {
          projectPath,
          plan,
          seed: 12345,
          failFast: true,
          exportPreview: true,
          smokeTest: true,
        },
        120_000,
      );

      if (!resp.ok) {
        const failedStep =
          resp.summary?.match(/pixel_\w+/u)?.[0] ?? 'unknown step';
        throw new Error(
          `pixel_macro_run with preview/smoke failed at ${failedStep}: ${resp.summary}`,
        );
      }

      assert.equal(resp.ok, true);

      const manifestPath = path.join(
        projectPath,
        '.godot_mcp',
        'pixel_manifest.json',
      );
      assert.ok(fs.existsSync(manifestPath), 'manifest not found');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      const stepNames = manifest.steps
        .map((s) => (s && typeof s === 'object' ? s.name : undefined))
        .filter((n) => typeof n === 'string');

      assert.ok(
        stepNames.includes('pixel_export_preview'),
        `Missing step: pixel_export_preview. Found: ${stepNames.join(', ')}`,
      );
      assert.ok(
        stepNames.includes('pixel_smoke_test'),
        `Missing step: pixel_smoke_test. Found: ${stepNames.join(', ')}`,
      );

      const previewStep = manifest.steps.find(
        (s) => s && s.name === 'pixel_export_preview',
      );
      if (
        previewStep &&
        previewStep.outputs &&
        previewStep.outputs.outputPngPath
      ) {
        const previewPngPath = resolveResPath(
          projectPath,
          previewStep.outputs.outputPngPath,
        );
        assert.ok(
          previewPngPath && fs.existsSync(previewPngPath),
          'preview PNG missing',
        );
      }

      const smokeStep = manifest.steps.find(
        (s) => s && s.name === 'pixel_smoke_test',
      );
      if (smokeStep && smokeStep.outputs) {
        assert.ok(
          Array.isArray(smokeStep.outputs.issues),
          'smoke test issues should be an array',
        );
      }
    } finally {
      client.dispose();
      server.kill();
      await rmrfWithRetries(projectPath);
    }
  },
);
