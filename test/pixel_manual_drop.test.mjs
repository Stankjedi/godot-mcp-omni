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

test('pixel_tilemap_generate manual_drop fails early when tilesheet PNG is missing (CI-safe)', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-manual-drop-');
  writeMinimalProject(projectPath, 'ManualDropTilemap');

  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('pixel_tilemap_generate', {
      projectPath,
      spec: { name: 'ManualDropTileset' },
      imageGenMode: 'manual_drop',
      allowExternalTools: false,
    });

    assert.equal(resp.ok, false);
    assert.ok(resp.details && typeof resp.details === 'object');
    assert.ok(Array.isArray(resp.details.requiredFiles));
    assert.ok(
      resp.details.requiredFiles.includes(
        'res://assets/generated/tilesets/ManualDropTileset/ManualDropTileset.png',
      ),
    );
    assert.ok(Array.isArray(resp.details.suggestions));
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('pixel_object_generate manual_drop fails early when sprite PNG is missing (CI-safe)', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-manual-drop-');
  writeMinimalProject(projectPath, 'ManualDropObjects');

  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('pixel_object_generate', {
      projectPath,
      spec: {
        objects: [{ id: 'rock', representation: 'tile' }],
      },
      imageGenMode: 'manual_drop',
      allowExternalTools: false,
    });

    assert.equal(resp.ok, false);
    assert.ok(resp.details && typeof resp.details === 'object');
    assert.ok(Array.isArray(resp.details.requiredFiles));
    assert.ok(
      resp.details.requiredFiles.includes(
        'res://assets/generated/sprites/rock/rock.png',
      ),
    );
    assert.ok(Array.isArray(resp.details.suggestions));
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});
