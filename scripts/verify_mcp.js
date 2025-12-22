import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { spawn } from 'child_process';

import { detectGodotPath, isValidGodotPath } from '../build/godot_cli.js';
import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';

const TOKEN = (process.env.VERIFY_MCP_TOKEN ?? 'verify-token').trim();
const PORT = Number.parseInt(process.env.VERIFY_MCP_PORT ?? '8765', 10);
const DEBUG = process.env.VERIFY_MCP_DEBUG === 'true';
const SKIP_EDITOR = process.env.VERIFY_MCP_SKIP_EDITOR === 'true';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureGodotPath() {
  const fromEnv = process.env.GODOT_PATH?.trim();
  const detected = fromEnv || (await detectGodotPath({ strictPathValidation: true }));
  if (process.env.VERIFY_MCP_SKIP_GODOT_CHECK === 'true') {
    return detected;
  }
  const cache = new Map();
  const ok = await isValidGodotPath(detected, cache);
  if (!ok) {
    throw new Error(
      `Godot executable is not valid: ${detected}\n` +
        `Set GODOT_PATH to a working Godot binary, or ensure 'godot --version' succeeds.`
    );
  }
  return detected;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '..');
  const serverEntry = path.join(repoRoot, 'build', 'index.js');

  const godotPath = await ensureGodotPath();

  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'godot-mcp-verify-'));
  const projectPath = path.join(workspaceRoot, 'TestProject');
  await fs.mkdir(projectPath, { recursive: true });

  const projectGodot = [
    '; Engine configuration file.',
    "; It's best edited using the editor, not directly.",
    'config_version=5',
    '',
    '[application]',
    'config/name="godot-mcp-verify"',
    '',
  ].join('\n');
  await fs.writeFile(path.join(projectPath, 'project.godot'), projectGodot, 'utf8');
  await fs.writeFile(path.join(projectPath, '.godot_mcp_token'), TOKEN, 'utf8');

  const server = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      GODOT_PATH: godotPath,
      ALLOW_DANGEROUS_OPS: 'true',
      GODOT_MCP_TOKEN: TOKEN,
      GODOT_MCP_PORT: String(PORT),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const client = new JsonRpcProcessClient(server);
  const results = [];

  const shutdown = async () => {
    client.dispose();
    try {
      server.kill();
    } catch {
      // ignore
    }
    try {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  server.stderr.on('data', (d) => {
    if (DEBUG) process.stderr.write(d);
  });

  const runStep = async (label, fn) => {
    console.log(`RUN: ${label}`);
    try {
      const value = await fn();
      results.push({ label, ok: true });
      console.log(`PASS: ${label}`);
      return value;
    } catch (error) {
      results.push({ label, ok: false, error: formatError(error) });
      console.log(`FAIL: ${label} -> ${formatError(error)}`);
      return null;
    }
  };

  try {
    await wait(200);
    await runStep('tools/list', async () => client.send('tools/list', {}));
    await runStep('get_godot_version', async () => client.callToolOrThrow('get_godot_version', {}));

    await runStep('list_projects', async () =>
      client.callToolOrThrow('list_projects', { directory: workspaceRoot, recursive: false })
    );

    await runStep('get_project_info', async () =>
      client.callToolOrThrow('get_project_info', { projectPath })
    );

    await runStep('godot_sync_addon', async () =>
      client.callToolOrThrow('godot_sync_addon', { projectPath, enablePlugin: true })
    );

    await runStep('create_scene', async () =>
      client.callToolOrThrow('create_scene', {
        projectPath,
        scenePath: '.godot_mcp/verify/Verify.tscn',
        rootNodeType: 'Node2D',
      })
    );

    await runStep('add_node', async () =>
      client.callToolOrThrow('add_node', {
        projectPath,
        scenePath: '.godot_mcp/verify/Verify.tscn',
        parentNodePath: 'root',
        nodeType: 'Sprite2D',
        nodeName: 'Sprite',
        properties: {},
      })
    );

    await runStep('save_scene', async () =>
      client.callToolOrThrow('save_scene', {
        projectPath,
        scenePath: '.godot_mcp/verify/Verify.tscn',
      })
    );

    await runStep('godot_headless_op.write_text_file', async () =>
      client.callToolOrThrow('godot_headless_op', {
        projectPath,
        operation: 'write_text_file',
        params: { path: '.godot_mcp/verify/notes.txt', content: 'verify_mcp: ok\n' },
      })
    );

    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      'base64'
    );
    await fs.writeFile(path.join(projectPath, 'icon.png'), pngBytes);

    await runStep('load_sprite', async () =>
      client.callToolOrThrow('load_sprite', {
        projectPath,
        scenePath: '.godot_mcp/verify/Verify.tscn',
        nodePath: 'root/Sprite',
        texturePath: 'res://icon.png',
      })
    );

    const meshScene = [
      '[gd_scene load_steps=2 format=3]',
      '',
      '[sub_resource type="BoxMesh" id=1]',
      '',
      '[node name="Root" type="Node3D"]',
      '[node name="Cube" type="MeshInstance3D" parent="."]',
      'mesh = SubResource(1)',
      '',
    ].join('\n');

    await runStep('godot_headless_op.write_mesh_scene', async () =>
      client.callToolOrThrow('godot_headless_op', {
        projectPath,
        operation: 'write_text_file',
        params: { path: '.godot_mcp/verify/MeshScene.tscn', content: meshScene },
      })
    );

    await runStep('godot_headless_op.create_resource', async () =>
      client.callToolOrThrow('godot_headless_op', {
        projectPath,
        operation: 'create_resource',
        params: { resourcePath: '.godot_mcp/verify/BoxMesh.tres', type: 'BoxMesh' },
      })
    );

    await runStep('export_mesh_library', async () =>
      client.callToolOrThrow('export_mesh_library', {
        projectPath,
        scenePath: '.godot_mcp/verify/MeshScene.tscn',
        outputPath: '.godot_mcp/verify/MeshLibrary.tres',
      })
    );

    await runStep('update_project_uids', async () =>
      client.callToolOrThrow('update_project_uids', { projectPath })
    );

    await runStep('get_uid', async () =>
      client.callToolOrThrow('get_uid', {
        projectPath,
        filePath: '.godot_mcp/verify/BoxMesh.tres',
      })
    );

    await runStep('run_project', async () =>
      client.callToolOrThrow('run_project', {
        projectPath,
        scene: 'res://.godot_mcp/verify/Verify.tscn',
      })
    );

    await wait(1000);

    await runStep('get_debug_output', async () => client.callToolOrThrow('get_debug_output', {}));
    await runStep('stop_project', async () => client.callToolOrThrow('stop_project', {}));

    await runStep('launch_editor', async () =>
      client.callToolOrThrow('launch_editor', { projectPath })
    );

    if (!SKIP_EDITOR) {
      await runStep('godot_connect_editor', async () =>
        client.callToolOrThrow('godot_connect_editor', {
          projectPath,
          token: TOKEN,
          port: PORT,
          timeoutMs: 30000,
        })
      );

      await runStep('godot_rpc.health', async () =>
        client.callToolOrThrow('godot_rpc', {
          request_json: { method: 'health', params: {} },
          timeoutMs: 30000,
        }, 60000)
      );

      await runStep('godot_inspect.class', async () =>
        client.callToolOrThrow('godot_inspect', {
          query_json: { class_name: 'Node' },
          timeoutMs: 30000,
        }, 60000)
      );
    }
  } finally {
    await shutdown();
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);

  console.log(`Verification complete. Passed: ${passed.length}, Failed: ${failed.length}`);
  for (const item of results) {
    const status = item.ok ? 'PASS' : 'FAIL';
    const suffix = item.ok ? '' : ` -> ${item.error}`;
    console.log(`${status}: ${item.label}${suffix}`);
  }

  if (failed.length > 0) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
