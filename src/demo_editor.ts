import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { detectGodotPath, isValidGodotPath } from './godot_cli.js';
import { JsonRpcProcessClient } from './utils/jsonrpc_process_client.js';

async function ensureTempProjectHasAddon(
  projectPath: string,
  repoRoot: string,
): Promise<void> {
  const srcAddon = path.join(repoRoot, 'addons', 'godot_mcp_bridge');
  const dstAddon = path.join(projectPath, 'addons', 'godot_mcp_bridge');
  await fs.mkdir(path.dirname(dstAddon), { recursive: true });
  await fs.cp(srcAddon, dstAddon, { recursive: true, force: true });
}

async function writeMinimalProject(
  projectPath: string,
  enablePlugin: boolean,
): Promise<void> {
  await fs.mkdir(path.join(projectPath, 'scenes'), { recursive: true });

  const lines: string[] = [
    '; Engine configuration file.',
    "; It's best edited using the editor, not directly.",
    'config_version=5',
    '',
    '[application]',
    'config/name="godot-mcp-omni-demo"',
    '',
  ];

  if (enablePlugin) {
    lines.push('[editor_plugins]');
    lines.push('enabled=PackedStringArray("godot_mcp_bridge")');
    lines.push('');
  }

  await fs.writeFile(
    path.join(projectPath, 'project.godot'),
    lines.join('\n'),
    'utf8',
  );
}

async function main() {
  const debug = process.env.DEMO_DEBUG === 'true';

  const godotPath = await detectGodotPath({
    strictPathValidation: true,
    debug: debug ? (m) => console.error(`[demo] ${m}`) : undefined,
  });

  const cache = new Map<string, boolean>();
  const ok = await isValidGodotPath(godotPath, cache);
  if (!ok) {
    throw new Error(
      `Godot executable is not valid: ${godotPath}\n` +
        `Set GODOT_PATH to a working Godot binary, or ensure 'godot --version' succeeds.`,
    );
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '..');
  const serverEntry = path.join(__dirname, 'index.js');

  const explicitProjectPath = process.env.DEMO_PROJECT_PATH?.trim();
  const shouldCreateProject = !explicitProjectPath;

  const projectPath = shouldCreateProject
    ? await fs.mkdtemp(path.join(os.tmpdir(), 'godot-mcp-omni-editor-demo-'))
    : path.resolve(explicitProjectPath as string);

  if (shouldCreateProject) {
    await writeMinimalProject(projectPath, true);
    await ensureTempProjectHasAddon(projectPath, repoRoot);
  } else {
    try {
      await fs.access(path.join(projectPath, 'project.godot'));
    } catch {
      throw new Error(
        `Not a valid Godot project (missing project.godot): ${projectPath}`,
      );
    }
  }

  const token =
    process.env.DEMO_TOKEN?.trim() || crypto.randomBytes(24).toString('hex');

  const server = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      GODOT_PATH: godotPath,
      DEBUG: debug ? 'true' : 'false',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const client = new JsonRpcProcessClient(server);

  const shutdown = async () => {
    client.dispose();
    try {
      server.kill();
    } catch {
      // ignore
    }
    try {
      if (shouldCreateProject)
        await fs.rm(projectPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  server.stderr.on('data', (d: Buffer) => {
    if (debug) process.stderr.write(d);
  });

  const send = async (method: string, params: unknown, timeoutMs = 30000) =>
    await client.send(method, params, timeoutMs);
  const callTool = async (name: string, args: Record<string, unknown>) =>
    await client.callToolOrThrow(name, args);

  try {
    const listResp = await send('tools/list', {});
    if ('error' in listResp)
      throw new Error(`tools/list error: ${JSON.stringify(listResp.error)}`);

    const demoSceneRel = '.godot_mcp/demo/Demo.tscn';
    const demoSceneRes = 'res://.godot_mcp/demo/Demo.tscn';

    await callTool('create_scene', {
      projectPath,
      scenePath: demoSceneRel,
      rootNodeType: 'Node2D',
    });

    await callTool('godot_connect_editor', {
      projectPath,
      token,
      timeoutMs: 60000,
    });

    await callTool('godot_rpc', {
      request_json: { method: 'health', params: {} },
      timeoutMs: 10000,
    });
    await callTool('godot_rpc', {
      request_json: { method: 'open_scene', params: { path: demoSceneRes } },
      timeoutMs: 20000,
    });

    await callTool('godot_rpc', {
      request_json: {
        method: 'begin_action',
        params: { name: 'demo:add+set' },
      },
    });
    await callTool('godot_rpc', {
      request_json: {
        method: 'add_node',
        params: {
          parent_path: 'root',
          type: 'Node2D',
          name: 'BatchNode',
          props: { unique_name_in_owner: true },
        },
      },
    });
    await callTool('godot_rpc', {
      request_json: {
        method: 'set_property',
        params: {
          node_path: 'root/BatchNode',
          property: 'visible',
          value: false,
        },
      },
    });
    await callTool('godot_rpc', {
      request_json: { method: 'commit_action', params: {} },
    });

    await callTool('godot_rpc', {
      request_json: { method: 'save_scene', params: {} },
      timeoutMs: 20000,
    });

    await callTool('godot_rpc', {
      request_json: { method: 'filesystem.scan', params: {} },
      timeoutMs: 20000,
    });
    await callTool('godot_rpc', {
      request_json: {
        method: 'filesystem.reimport_files',
        params: { files: [demoSceneRes] },
      },
      timeoutMs: 20000,
    });

    await callTool('godot_inspect', {
      query_json: { class_name: 'Node2D' },
      timeoutMs: 20000,
    });
    await callTool('godot_inspect', {
      query_json: { node_path: '%BatchNode' },
      timeoutMs: 20000,
    });

    await callTool('godot_rpc', {
      request_json: {
        method: 'call',
        params: {
          target_type: 'node',
          target_id: '%BatchNode',
          method: 'get_class',
          args: [],
        },
      },
    });

    console.log('Editor demo completed.');
    console.log(
      'Undo check: in the editor, press Ctrl/Cmd+Z once. The BatchNode add + visible change should revert together.',
    );
  } finally {
    await shutdown();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
