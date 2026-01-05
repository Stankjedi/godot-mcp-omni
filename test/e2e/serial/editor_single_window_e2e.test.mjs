import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  normalizeGodotArgsForHost,
  normalizeGodotPathForHost,
} from '../../../build/godot_cli.js';
import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import {
  isWindowsExePath,
  mkdtemp,
  startServer,
  waitForServerReady,
  writeMinimalProject,
} from '../helpers.mjs';

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

  const headlessTscn = [
    '[gd_scene load_steps=2 format=3]',
    '',
    '[node name="Headless" type="Node2D"]',
    '',
  ].join('\n');
  fs.writeFileSync(
    path.join(projectPath, 'Headless.tscn'),
    headlessTscn,
    'utf8',
  );

  const spriteScene = [
    '[gd_scene load_steps=2 format=3]',
    '',
    '[node name="Root" type="Node2D"]',
    '[node name="Sprite" type="Sprite2D" parent="."]',
    '',
  ].join('\n');
  fs.writeFileSync(
    path.join(projectPath, 'SpriteScene.tscn'),
    spriteScene,
    'utf8',
  );
}

function writeTestScript(projectPath) {
  const script = [
    'extends Node',
    '',
    'func _ready() -> void:',
    '\tpass',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(projectPath, 'TestScript.gd'), script, 'utf8');
}

function writeTinyPng(projectPath) {
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );
  fs.writeFileSync(path.join(projectPath, 'icon.png'), pngBytes);
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

function spawnGodotEditorHeadless(godotPath, projectPath, env) {
  const resolvedGodotPath = normalizeGodotPathForHost(godotPath);
  const args = normalizeGodotArgsForHost(resolvedGodotPath, [
    '--headless',
    '-e',
    '--path',
    projectPath,
  ]);
  return spawn(resolvedGodotPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...env },
  });
}

function spawnGodotEditorGui(godotPath, projectPath, env) {
  const resolvedGodotPath = normalizeGodotPathForHost(godotPath);
  const args = normalizeGodotArgsForHost(resolvedGodotPath, [
    '--rendering-driver',
    'opengl3',
    '-e',
    '--path',
    projectPath,
  ]);
  return spawn(resolvedGodotPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...env },
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
  if (await waitForExit(5000)) return;

  try {
    proc.kill('SIGKILL');
  } catch {
    // ignore
  }
  if (await waitForExit(5000)) return;

  // WSL sometimes fails to terminate Windows .exe processes via POSIX signals.
  if (process.platform !== 'win32' && typeof proc.pid === 'number') {
    try {
      spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } catch {
      // ignore
    }
  }

  await waitForExit(5000);
}

async function rmRecursiveWithRetry(targetPath, attempts = 12) {
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
      if (!retryable) throw error;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // Best-effort: leave the temp dir behind if Windows is still holding locks.
}

function getToolNames(listResult) {
  const tools =
    listResult && typeof listResult === 'object' ? listResult.tools : undefined;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => (t && typeof t === 'object' ? t.name : undefined))
    .filter((n) => typeof n === 'string');
}

function getOptionalObserveDelayMs() {
  const raw = process.env.GODOT_MCP_OBSERVE_MS ?? '';
  if (!raw.trim()) return 0;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function maybeObserve() {
  const ms = getOptionalObserveDelayMs();
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

test(
  'Editor + unified tools run in a single editor session (one window)',
  {
    skip: process.env.GODOT_PATH ? false : 'GODOT_PATH not set',
    timeout: 240000,
  },
  async () => {
    const godotPath = process.env.GODOT_PATH;
    assert.ok(godotPath);

    const needsWslWinPathTranslation =
      process.platform !== 'win32' && isWindowsExePath(godotPath);
    const connectHost = needsWslWinPathTranslation
      ? (readWslGatewayIp() ?? '127.0.0.1')
      : '127.0.0.1';

    const projectPath = mkdtemp('godot-mcp-omni-single-editor-e2e-');
    const port = randomPort();
    const token = `single-token-${Math.random().toString(16).slice(2)}`;

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
      writeMinimalProject(
        projectPath,
        'godot-mcp-omni-single-editor-e2e',
        'res://Main.tscn',
      );
      writeMinimalScenes(projectPath);
      writeTestScript(projectPath);
      writeTinyPng(projectPath);

      await waitForServerReady(client);

      // Ensure unified tools are registered.
      const listResp = await client.send('tools/list', {}, 30000);
      if ('error' in listResp) {
        throw new Error(`tools/list error: ${JSON.stringify(listResp.error)}`);
      }
      const toolNames = getToolNames(listResp.result);
      for (const name of [
        'godot_scene_manager',
        'godot_inspector_manager',
        'godot_asset_manager',
        'godot_workspace_manager',
        'godot_editor_view_manager',
      ]) {
        assert.ok(
          toolNames.includes(name),
          `Missing unified tool in registry: ${name}`,
        );
      }

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

      // Headless fallback checks (no editor connection).
      const headlessCreate = await client.callToolOrThrow(
        'godot_scene_manager',
        {
          action: 'create',
          projectPath,
          scenePath: 'Headless.tscn',
          parentNodePath: 'root',
          nodeType: 'Node2D',
          nodeName: 'HeadlessNode',
          props: { position: { $type: 'Vector2', x: 1, y: 2 } },
        },
      );
      assert.equal(headlessCreate.ok, true);

      const headlessConnectSignal = await client.callToolOrThrow(
        'godot_inspector_manager',
        {
          action: 'connect_signal',
          projectPath,
          scenePath: 'Headless.tscn',
          fromNodePath: 'root',
          toNodePath: 'root',
          signal: 'tree_entered',
          method: '_ready',
        },
      );
      assert.equal(headlessConnectSignal.ok, true);

      const headlessLoadTexture = await client.callToolOrThrow(
        'godot_asset_manager',
        {
          action: 'load_texture',
          projectPath,
          scenePath: 'SpriteScene.tscn',
          nodePath: 'root/Sprite',
          texturePath: 'res://icon.png',
        },
      );
      assert.equal(headlessLoadTexture.ok, true);

      // Start a single editor instance (headless by default, GUI when requested).
      const wantsGui = process.env.GODOT_MCP_GUI_TEST === 'true';
      godotProc = wantsGui
        ? spawnGodotEditorGui(godotPath, projectPath, {
            GODOT_MCP_TOKEN: token,
            GODOT_MCP_PORT: String(port),
            GODOT_MCP_HOST: '0.0.0.0',
          })
        : spawnGodotEditorHeadless(godotPath, projectPath, {
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

      const portReady = await waitForPortOpen(
        connectHost,
        port,
        wantsGui ? 90000 : 60000,
      );
      assert.equal(portReady, true, 'Editor bridge did not open the TCP port');

      const connectResp = await client.callToolOrThrow(
        'godot_workspace_manager',
        {
          action: 'connect',
          projectPath,
          host: connectHost,
          port,
          token,
          timeoutMs: 60000,
        },
      );
      assert.equal(connectResp.ok, true);

      const status = await client.callToolOrThrow('godot_workspace_manager', {
        action: 'status',
        projectPath,
      });
      assert.equal(status.details?.connected, true);

      await client.callToolOrThrow('godot_workspace_manager', {
        action: 'open_scene',
        scenePath: 'res://Main.tscn',
      });
      await maybeObserve();

      // ---- Base editor tools (editor_tools_e2e) ----
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
        'godot_inspector_manager',
        {
          action: 'query',
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

      const query = await client.callToolOrThrow('godot_inspector_manager', {
        action: 'query',
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

      const dupResp = await client.callToolOrThrow('godot_scene_manager', {
        action: 'duplicate',
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

      const reparentResp = await client.callToolOrThrow('godot_scene_manager', {
        action: 'reparent',
        nodePath: batchNodePath,
        newParentPath: 'Parent',
        timeoutMs: 30000,
      });
      assert.equal(reparentResp.ok, true);

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'instance',
        scenePath: 'res://SubScene.tscn',
        parentPath: 'root',
        name: 'SubInst',
        timeoutMs: 30000,
      });

      const selectResp = await client.callToolOrThrow(
        'godot_inspector_manager',
        {
          action: 'select',
          nodePath: 'SubInst',
          timeoutMs: 30000,
        },
      );
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
        'godot_inspector_manager',
        {
          action: 'disconnect_signal',
          fromNodePath: 'Emitter',
          signal: 'tree_entered',
          toNodePath: 'Receiver',
          method: 'queue_free',
          timeoutMs: 30000,
        },
      );
      assert.equal(disconnectResp.ok, true);

      // ---- Unified tools (unified_tools_e2e) ----
      await client.callToolOrThrow('godot_asset_manager', { action: 'scan' });

      await client.callToolOrThrow('godot_asset_manager', {
        action: 'auto_import_check',
        files: ['res://icon.png'],
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'create',
        parentNodePath: 'root',
        nodeType: 'Node2D',
        nodeName: 'UniNode',
        props: { position: { $type: 'Vector2', x: 3, y: 4 } },
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'create',
        parentNodePath: 'root',
        nodeType: 'CharacterBody2D',
        nodeName: 'Player2D',
        autoAttach: true,
        primitive: 'circle',
        sprite: 'res://icon.png',
        collisionLayerBits: [true, false, true],
        collisionMaskBits: [true],
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'update',
        nodePath: 'Player2D',
        collisionMask: 3,
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'attach_script',
        nodePath: 'Player2D',
        scriptPath: 'res://TestScript.gd',
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'attach_components',
        nodePath: 'Player2D',
        components: [{ nodeType: 'Node2D', nodeName: 'PlayerTag' }],
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'create_tilemap',
        nodeName: 'EditorTilemap',
        tileSetTexturePath: 'res://icon.png',
        tileSize: { x: 1, y: 1 },
        cells: [{ x: 0, y: 0, atlasX: 0, atlasY: 0 }],
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'create_ui',
        uiRootName: 'EditorUI',
        elements: [
          {
            nodeType: 'Label',
            nodeName: 'HudLabel',
            props: { text: 'HUD' },
            layout: 'top',
          },
        ],
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'batch_create',
        items: [
          { nodeType: 'Node2D', nodeName: 'BatchNode1' },
          {
            nodeType: 'Node2D',
            nodeName: 'BatchNode2',
            props: { position: { $type: 'Vector2', x: 10, y: 20 } },
          },
        ],
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'duplicate',
        nodePath: 'UniNode',
        newName: 'UniNodeCopy',
        timeoutMs: 30000,
      });

      const queryUniNodeCopy = await client.callToolOrThrow(
        'godot_inspector_manager',
        {
          action: 'query',
          name: 'UniNodeCopy',
          includeRoot: true,
          limit: 10,
          timeoutMs: 30000,
        },
      );
      assert.equal(queryUniNodeCopy.details?.result?.count, 1);

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'remove',
        nodePath: 'UniNodeCopy',
        timeoutMs: 30000,
      });

      const afterRemove = await client.callToolOrThrow(
        'godot_inspector_manager',
        {
          action: 'query',
          name: 'UniNodeCopy',
          includeRoot: true,
          limit: 10,
          timeoutMs: 30000,
        },
      );
      assert.equal(afterRemove.details?.result?.count, 0);

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'undo',
        timeoutMs: 30000,
      });
      const afterUndo = await client.callToolOrThrow(
        'godot_inspector_manager',
        {
          action: 'query',
          name: 'UniNodeCopy',
          includeRoot: true,
          limit: 10,
          timeoutMs: 30000,
        },
      );
      assert.equal(afterUndo.details?.result?.count, 1);

      await client.callToolOrThrow('godot_scene_manager', {
        action: 'redo',
        timeoutMs: 30000,
      });
      const afterRedo = await client.callToolOrThrow(
        'godot_inspector_manager',
        {
          action: 'query',
          name: 'UniNodeCopy',
          includeRoot: true,
          limit: 10,
          timeoutMs: 30000,
        },
      );
      assert.equal(afterRedo.details?.result?.count, 0);

      const inspectParent = await client.callToolOrThrow(
        'godot_inspector_manager',
        {
          action: 'inspect',
          nodePath: 'Parent',
          timeoutMs: 30000,
        },
      );
      assert.equal(inspectParent.details?.result?.name, 'Parent');

      const propertyList = await client.callToolOrThrow(
        'godot_inspector_manager',
        {
          action: 'property_list',
          className: 'Node2D',
          timeoutMs: 30000,
        },
      );
      assert.ok(Array.isArray(propertyList.details?.properties));

      await client.callToolOrThrow('godot_inspector_manager', {
        action: 'select',
        nodePath: 'SubInst',
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_inspector_manager', {
        action: 'connect_signal',
        fromNodePath: 'Emitter',
        signal: 'tree_entered',
        toNodePath: 'Receiver',
        method: 'queue_free',
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_inspector_manager', {
        action: 'disconnect_signal',
        fromNodePath: 'Emitter',
        signal: 'tree_entered',
        toNodePath: 'Receiver',
        method: 'queue_free',
        timeoutMs: 30000,
      });

      await client.callToolOrThrow('godot_asset_manager', {
        action: 'reimport',
        files: ['res://Main.tscn'],
      });

      const uidResp = await client.callToolOrThrow('godot_asset_manager', {
        action: 'get_uid',
        projectPath,
        filePath: 'Main.tscn',
      });
      assert.equal(uidResp.ok, true);

      await client.callToolOrThrow('godot_editor_view_manager', {
        action: 'switch_screen',
        screenName: 'Script',
        timeoutMs: 60000,
      });
      await maybeObserve();

      await client.callToolOrThrow('godot_editor_view_manager', {
        action: 'edit_script',
        scriptPath: 'res://TestScript.gd',
        lineNumber: 1,
        timeoutMs: 60000,
      });
      await maybeObserve();

      await client.callToolOrThrow('godot_editor_view_manager', {
        action: 'add_breakpoint',
        scriptPath: 'res://TestScript.gd',
        lineNumber: 1,
        timeoutMs: 60000,
      });

      const capture = await client.callTool('godot_editor_view_manager', {
        action: 'capture_viewport',
        maxSize: 256,
        timeoutMs: 60000,
      });
      if (wantsGui) {
        assert.equal(capture.ok, true);
        assert.equal(capture.details?.result?.content_type, 'image/png');
        assert.ok(
          typeof capture.details?.result?.base64 === 'string' &&
            capture.details.result.base64.length > 100,
        );
      } else {
        assert.equal(capture.ok, false);
      }

      await client.callToolOrThrow('godot_workspace_manager', {
        action: 'save_all',
        timeoutMs: 60000,
      });

      // Avoid GUI play edge-cases: run/stop headlessly.
      await client.callToolOrThrow('godot_workspace_manager', {
        action: 'run',
        mode: 'headless',
        projectPath,
        scene: 'res://Main.tscn',
      });
      await new Promise((r) => setTimeout(r, 600));
      await client.callToolOrThrow('godot_workspace_manager', {
        action: 'stop',
        mode: 'headless',
      });
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
