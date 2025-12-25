import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeGodotArgsForHost } from '../build/godot_cli.js';
import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';

function isWindowsExePath(p) {
  return typeof p === 'string' && p.toLowerCase().endsWith('.exe');
}

function mkdtemp(prefix) {
  const godotPath = process.env.GODOT_PATH ?? '';
  const needsWslWinPathTranslation =
    process.platform !== 'win32' && isWindowsExePath(godotPath);
  const base = needsWslWinPathTranslation
    ? path.join(process.cwd(), '.tmp')
    : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

function writeMinimalProject(projectPath, name) {
  const projectGodot = [
    '; Engine configuration file.',
    "; It's best edited using the editor, not directly.",
    'config_version=5',
    '',
    '[application]',
    `config/name="${name}"`,
    '',
  ].join('\n');

  fs.writeFileSync(
    path.join(projectPath, 'project.godot'),
    projectGodot,
    'utf8',
  );
}

function writeMinimalScenes(projectPath) {
  const mainTscn = [
    '[gd_scene load_steps=2 format=3]',
    '',
    '[node name="Main" type="Node2D"]',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(projectPath, 'Main.tscn'), mainTscn, 'utf8');

  const subSceneTscn = [
    '[gd_scene load_steps=2 format=3]',
    '',
    '[node name="SubRoot" type="Node2D"]',
    '',
  ].join('\n');
  fs.writeFileSync(
    path.join(projectPath, 'SubScene.tscn'),
    subSceneTscn,
    'utf8',
  );
}

function startServer(env = {}) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverEntry = path.join(__dirname, '..', 'build', 'index.js');
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      ...env,
    },
  });
  return child;
}

async function waitForServerStartup() {
  await new Promise((r) => setTimeout(r, 300));
}

function readWslGatewayIp() {
  try {
    const route = fs.readFileSync('/proc/net/route', 'utf8');
    const lines = route.split(/\r?\n/u);
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const cols = line.split(/\s+/u);
      if (cols.length < 3) continue;
      if (cols[1] !== '00000000') continue;
      const hex = cols[2];
      if (!/^[0-9a-fA-F]+$/u.test(hex)) continue;
      const num = (Number.parseInt(hex, 16) >>> 0) | 0;
      const gatewayIp = [
        num & 0xff,
        (num >>> 8) & 0xff,
        (num >>> 16) & 0xff,
        (num >>> 24) & 0xff,
      ].join('.');
      if (gatewayIp !== '0.0.0.0') return gatewayIp;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function randomPort() {
  return Math.floor(20000 + Math.random() * 20000);
}

async function waitForPortOpen(host, port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (value) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(500);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function spawnGodotEditor(godotPath, projectPath, env) {
  const args = normalizeGodotArgsForHost(godotPath, [
    '--headless',
    '-e',
    '--path',
    projectPath,
  ]);
  return spawn(godotPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      ...env,
    },
  });
}

async function killProcess(proc) {
  if (!proc || proc.killed) return;
  const waitForExit = (timeoutMs) =>
    new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), timeoutMs);
      proc.once('exit', () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });

  proc.kill();
  const exited = await waitForExit(5000);
  if (exited) return;
  try {
    proc.kill('SIGKILL');
  } catch {
    // ignore
  }
  await waitForExit(5000);
}

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

test('Editor tools are CI-safe when not connected (no Godot required)', async () => {
  const server = startServer();
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();

    const toolNames = [
      'godot_editor_batch',
      'godot_select_node',
      'godot_scene_tree_query',
      'godot_duplicate_node',
      'godot_reparent_node',
      'godot_add_scene_instance',
      'godot_disconnect_signal',
    ];

    for (const name of toolNames) {
      const res = await client.callTool(name, {});
      assert.equal(res.ok, false);
      assert.equal(res.summary, 'Not connected to editor bridge');
    }
  } finally {
    client.dispose();
    server.kill();
  }
});

test(
  'Editor tools integration (Godot required): batch + query + edit operations',
  {
    skip: process.env.GODOT_PATH ? false : 'GODOT_PATH not set',
    timeout: 120000,
  },
  async () => {
    const godotPath = process.env.GODOT_PATH;
    assert.ok(godotPath);

    const needsWslWinPathTranslation =
      process.platform !== 'win32' && isWindowsExePath(godotPath);
    const connectHost = needsWslWinPathTranslation
      ? (readWslGatewayIp() ?? '127.0.0.1')
      : '127.0.0.1';

    const projectPath = mkdtemp('godot-mcp-omni-editor-e2e-');
    const port = randomPort();
    const token = `test-token-${Math.random().toString(16).slice(2)}`;

    const server = startServer({
      GODOT_PATH: godotPath,
      GODOT_MCP_TOKEN: token,
      GODOT_MCP_PORT: String(port),
      GODOT_MCP_HOST: '0.0.0.0',
    });
    const client = new JsonRpcProcessClient(server);

    const godotOutput = [];
    const godotErrors = [];
    let godotProc;

    try {
      writeMinimalProject(projectPath, 'godot-mcp-omni-editor-e2e');
      writeMinimalScenes(projectPath);

      await waitForServerStartup();

      await client.callToolOrThrow('godot_sync_addon', {
        projectPath,
        enablePlugin: true,
      });

      // Prefer file-based config for WSL -> Windows Godot interop.
      fs.writeFileSync(
        path.join(projectPath, '.godot_mcp_token'),
        token,
        'utf8',
      );
      fs.writeFileSync(
        path.join(projectPath, '.godot_mcp_port'),
        String(port),
        'utf8',
      );
      fs.writeFileSync(
        path.join(projectPath, '.godot_mcp_host'),
        '0.0.0.0',
        'utf8',
      );

      godotProc = spawnGodotEditor(godotPath, projectPath, {
        GODOT_MCP_TOKEN: token,
        GODOT_MCP_PORT: String(port),
        GODOT_MCP_HOST: '0.0.0.0',
      });

      godotProc.stdout?.on('data', (d) =>
        godotOutput.push(...d.toString('utf8').split(/\r?\n/u)),
      );
      godotProc.stderr?.on('data', (d) =>
        godotErrors.push(...d.toString('utf8').split(/\r?\n/u)),
      );

      const portReady = await waitForPortOpen(connectHost, port, 60000);
      assert.equal(portReady, true, 'Editor bridge did not open the TCP port');

      const connectResp = await client.callToolOrThrow('godot_connect_editor', {
        projectPath,
        host: connectHost,
        port,
        token,
        timeoutMs: 60000,
      });
      assert.equal(connectResp.ok, true);

      await client.callToolOrThrow('godot_rpc', {
        request_json: {
          method: 'open_scene',
          params: { path: 'res://Main.tscn' },
        },
        timeoutMs: 30000,
      });

      // Batch rollback: create node then fail, ensure it does not appear.
      const rollback = await client.callTool('godot_editor_batch', {
        actionName: 'test-rollback',
        stopOnError: true,
        timeoutMs: 30000,
        steps: [
          {
            method: 'add_node',
            params: { parent_path: 'root', type: 'Node2D', name: 'RolledBack' },
          },
          {
            method: 'set_property',
            params: {
              node_path: 'RolledBack',
              property: 'position',
              value: { $type: 'Vector2', x: 1, y: 2 },
            },
          },
        ],
      });
      assert.equal(rollback.ok, false);

      const rollbackQuery = await client.callToolOrThrow(
        'godot_scene_tree_query',
        {
          name: 'RolledBack',
          includeRoot: true,
          limit: 10,
        },
      );
      assert.equal(rollbackQuery.details?.result?.count, 0);

      // Batch success: add node to root.
      const batch = await client.callToolOrThrow('godot_editor_batch', {
        actionName: 'test-batch',
        stopOnError: true,
        timeoutMs: 30000,
        steps: [
          {
            method: 'add_node',
            params: {
              parent_path: 'root',
              type: 'Node2D',
              name: 'BatchNode',
              props: { position: { $type: 'Vector2', x: 12, y: 34 } },
            },
          },
        ],
      });
      assert.equal(batch.ok, true);

      const query = await client.callToolOrThrow('godot_scene_tree_query', {
        name: 'BatchNode',
        includeRoot: true,
        limit: 10,
      });
      assert.equal(query.details?.result?.count, 1);
      const batchNodePath = query.details.result.nodes[0].node_path;
      assert.ok(typeof batchNodePath === 'string' && batchNodePath.length > 0);

      // Variant serialization: set/get Vector2.
      await client.callToolOrThrow('godot_rpc', {
        request_json: {
          method: 'set_property',
          params: {
            node_path: batchNodePath,
            property: 'position',
            value: { $type: 'Vector2', x: 11, y: 22 },
          },
        },
        timeoutMs: 30000,
      });

      const posResp = await client.callToolOrThrow('godot_rpc', {
        request_json: {
          method: 'get_property',
          params: { node_path: batchNodePath, property: 'position' },
        },
        timeoutMs: 30000,
      });
      assert.equal(posResp.details?.result?.value?.$type, 'Vector2');
      assert.equal(posResp.details?.result?.value?.x, 11);
      assert.equal(posResp.details?.result?.value?.y, 22);

      const inspectResp = await client.callToolOrThrow('godot_rpc', {
        request_json: {
          method: 'inspect_object',
          params: {
            node_path: batchNodePath,
            property_names: ['position'],
          },
        },
        timeoutMs: 30000,
      });
      assert.equal(
        inspectResp.details?.result?.property_values?.position?.$type,
        'Vector2',
      );

      const dupResp = await client.callToolOrThrow('godot_duplicate_node', {
        nodePath: batchNodePath,
        newName: 'BatchNodeCopy',
        timeoutMs: 30000,
      });
      assert.equal(dupResp.ok, true);

      await client.callToolOrThrow('godot_rpc', {
        request_json: {
          method: 'add_node',
          params: { parent_path: 'root', type: 'Node2D', name: 'Parent' },
        },
        timeoutMs: 30000,
      });

      const reparentResp = await client.callToolOrThrow('godot_reparent_node', {
        nodePath: batchNodePath,
        newParentPath: 'Parent',
        timeoutMs: 30000,
      });
      assert.equal(reparentResp.ok, true);

      await client.callToolOrThrow('godot_add_scene_instance', {
        scenePath: 'res://SubScene.tscn',
        parentPath: 'root',
        name: 'SubInst',
        timeoutMs: 30000,
      });

      const selectResp = await client.callToolOrThrow('godot_select_node', {
        nodePath: 'SubInst',
        timeoutMs: 30000,
      });
      assert.equal(selectResp.ok, true);

      await client.callToolOrThrow('godot_rpc', {
        request_json: {
          method: 'add_node',
          params: { parent_path: 'root', type: 'Node', name: 'Emitter' },
        },
        timeoutMs: 30000,
      });
      await client.callToolOrThrow('godot_rpc', {
        request_json: {
          method: 'add_node',
          params: { parent_path: 'root', type: 'Node', name: 'Receiver' },
        },
        timeoutMs: 30000,
      });
      await client.callToolOrThrow('godot_rpc', {
        request_json: {
          method: 'connect_signal',
          params: {
            from_node_path: 'Emitter',
            signal: 'tree_entered',
            to_node_path: 'Receiver',
            method: 'queue_free',
          },
        },
        timeoutMs: 30000,
      });

      const disconnectResp = await client.callToolOrThrow(
        'godot_disconnect_signal',
        {
          fromNodePath: 'Emitter',
          signal: 'tree_entered',
          toNodePath: 'Receiver',
          method: 'queue_free',
          timeoutMs: 30000,
        },
      );
      assert.equal(disconnectResp.ok, true);
    } finally {
      client.dispose();
      server.kill();
      await killProcess(godotProc);

      const combined = [...godotOutput, ...godotErrors].join('\n');
      assert.ok(
        !/Parse Error:/u.test(combined),
        `Godot printed parse errors:\n${combined}`,
      );
      assert.ok(
        !/history mismatch/iu.test(combined),
        `Godot printed UndoRedo history mismatch:\n${combined}`,
      );

      await rmRecursiveWithRetry(projectPath);
    }
  },
);
