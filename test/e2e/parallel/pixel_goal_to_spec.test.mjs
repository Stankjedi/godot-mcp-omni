import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';

import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import {
  mkdtemp,
  startServer,
  waitForServerStartup,
  writeMinimalProject,
} from '../helpers.mjs';

const CI_SAFE_ENV = { GODOT_PATH: '' };

function createHttpSpecServer(planFactory) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        parsed = null;
      }
      const body = planFactory(parsed);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
  });
  return server;
}

test('pixel_goal_to_spec returns a builtin plan (no external tools)', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-pixel-goal-');
  writeMinimalProject(projectPath);

  const server = startServer(CI_SAFE_ENV);
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('pixel_goal_to_spec', {
      projectPath,
      goal: '타일맵 만들고 월드 생성해줘 (맵 크기 64x64, 숲/초원/강) 그리고 나무 넣어줘 밀도 0.2',
      allowExternalTools: false,
    });

    assert.equal(resp.ok, true);
    assert.ok(resp.details && typeof resp.details === 'object');
    assert.equal(resp.details.adapter, 'builtin');
    assert.ok(Array.isArray(resp.details.plan));

    const tools = resp.details.plan
      .map((s) => (s && typeof s === 'object' ? s.tool : undefined))
      .filter((t) => typeof t === 'string');
    for (const required of [
      'pixel_tilemap_generate',
      'pixel_world_generate',
      'pixel_object_generate',
      'pixel_object_place',
    ]) {
      assert.ok(tools.includes(required), `Missing step tool: ${required}`);
    }
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('pixel_macro_run rejects an unsupported explicit plan tool', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-pixel-macro-');
  writeMinimalProject(projectPath);

  const server = startServer(CI_SAFE_ENV);
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('pixel_macro_run', {
      projectPath,
      dryRun: true,
      plan: [{ tool: 'not_a_real_tool', args: {} }],
    });

    assert.equal(resp.ok, false);
    assert.match(resp.summary, /Unsupported macro step tool/u);
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('pixel_goal_to_spec can use HTTP spec generator when enabled', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-pixel-http-');
  writeMinimalProject(projectPath);

  const specServer = createHttpSpecServer(() => ({
    plan: [
      {
        tool: 'pixel_tilemap_generate',
        args: {
          spec: {
            name: 'pixel_base',
            tileSize: 16,
            sheet: { columns: 16, rows: 16 },
          },
        },
      },
      {
        tool: 'pixel_world_generate',
        args: {
          spec: {
            scenePath: 'res://scenes/generated/world/World.tscn',
            tilesetName: 'pixel_base',
            mapSize: { width: 32, height: 32 },
            seed: 123,
          },
        },
      },
    ],
  }));

  await new Promise((resolve) => specServer.listen(0, resolve));
  const port = specServer.address().port;
  const url = `http://127.0.0.1:${port}/spec`;

  const server = startServer({
    ...CI_SAFE_ENV,
    ALLOW_EXTERNAL_TOOLS: 'true',
    SPEC_GEN_URL: url,
  });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('pixel_goal_to_spec', {
      projectPath,
      goal: 'use http spec gen',
      allowExternalTools: true,
      timeoutMs: 5000,
    });

    assert.equal(resp.ok, true);
    assert.equal(resp.details.adapter, 'http');
    assert.ok(Array.isArray(resp.details.plan));
    assert.equal(resp.details.plan[0].tool, 'pixel_tilemap_generate');
  } finally {
    client.dispose();
    server.kill();
    await new Promise((resolve) => specServer.close(resolve));
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('pixel_goal_to_spec does not use HTTP adapter when allowExternalTools=false', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-pixel-http-gated-');
  writeMinimalProject(projectPath);

  const specServer = createHttpSpecServer(() => ({
    plan: [
      {
        tool: 'pixel_tilemap_generate',
        args: { spec: { name: 'pixel_base' } },
      },
    ],
  }));
  await new Promise((resolve) => specServer.listen(0, resolve));
  const port = specServer.address().port;
  const url = `http://127.0.0.1:${port}/spec`;

  const server = startServer({
    ...CI_SAFE_ENV,
    ALLOW_EXTERNAL_TOOLS: 'true',
    SPEC_GEN_URL: url,
  });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('pixel_goal_to_spec', {
      projectPath,
      goal: 'should not call http',
      allowExternalTools: false,
    });

    assert.equal(resp.ok, true);
    assert.equal(resp.details.adapter, 'builtin');
  } finally {
    client.dispose();
    server.kill();
    await new Promise((resolve) => specServer.close(resolve));
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('pixel_macro_run accepts extended spec fields (dry run)', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-pixel-extended-');
  writeMinimalProject(projectPath);

  const server = startServer(CI_SAFE_ENV);
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('pixel_macro_run', {
      projectPath,
      dryRun: true,
      plan: [
        {
          tool: 'pixel_world_generate',
          args: {
            spec: {
              scenePath: 'res://scenes/generated/world/World.tscn',
              tilesetName: 'pixel_base',
              mapSize: { width: 48, height: 48 },
              seed: 42,
              biomes: [
                { name: 'grass', weight: 0.6 },
                { name: 'forest', weight: 0.3 },
                { name: 'river', weight: 0.1 },
              ],
              placementRules: {
                river_carve: true,
                river_width: 2,
                river_frequency: 0.05,
                riverMeander: 1.0,
                noiseFrequency: 0.03,
                noise_octaves: 3,
                noise_lacunarity: 2.0,
                noise_gain: 0.5,
                sample_step: 4,
                smooth_iterations: 1,
                paths: {
                  enabled: true,
                  width: 2,
                  noise_frequency: 0.05,
                  meander: 8.0,
                  search_radius: 6,
                },
              },
            },
          },
        },
        {
          tool: 'pixel_object_place',
          args: {
            worldScenePath: 'res://scenes/generated/world/World.tscn',
            spec: {
              objects: [
                {
                  id: 'tree_small',
                  representation: 'tile',
                  placement: {
                    density: 0.2,
                    onTiles: ['grass', 'forest'],
                    avoidTiles: ['water'],
                    preferNearTiles: ['water'],
                    preferDistance: 6,
                    preferMultiplier: 1.5,
                    minDistance: 2,
                  },
                },
              ],
            },
          },
        },
      ],
    });

    assert.equal(resp.ok, true);
    assert.equal(resp.summary, 'Dry-run macro plan');
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('pixel_macro_run rejects invalid placement inputs', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-pixel-invalid-');
  writeMinimalProject(projectPath);

  const server = startServer(CI_SAFE_ENV);
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('pixel_macro_run', {
      projectPath,
      dryRun: true,
      plan: [
        {
          tool: 'pixel_object_place',
          args: {
            worldScenePath: 'res://scenes/generated/world/World.tscn',
            spec: {
              objects: [
                {
                  id: 'bad_object',
                  placement: {
                    onTiles: 'grass',
                  },
                },
              ],
            },
          },
        },
      ],
    });

    assert.equal(resp.ok, false);
    assert.ok(
      resp.summary.includes(
        'Invalid field "spec.objects[0].placement.onTiles"',
      ),
    );
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});
