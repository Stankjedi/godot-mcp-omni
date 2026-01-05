import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { spawn } from 'child_process';

import { detectGodotPath, isValidGodotPath } from './godot_cli.js';
import { JsonRpcProcessClient } from './utils/jsonrpc_process_client.js';

async function main() {
  const debug = process.env.SMOKE_DEBUG === 'true';

  const godotPath = await detectGodotPath({
    strictPathValidation: true,
    debug: debug ? (m) => console.error(`[smoke] ${m}`) : undefined,
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
  const serverEntry = path.join(__dirname, 'index.js');

  const repoRoot = path.resolve(__dirname, '..');
  const explicitProjectPath = process.env.SMOKE_PROJECT_PATH?.trim();
  const defaultSampleProjectPath = path.join(repoRoot, 'sample_project');

  let projectPath: string;
  let shouldCleanupProject = false;

  if (explicitProjectPath) {
    projectPath = path.resolve(explicitProjectPath);
  } else {
    try {
      await fs.access(path.join(defaultSampleProjectPath, 'project.godot'));
      projectPath = defaultSampleProjectPath;
    } catch {
      projectPath = await fs.mkdtemp(
        path.join(os.tmpdir(), 'godot-mcp-omni-smoke-'),
      );
      shouldCleanupProject = true;
      await fs.mkdir(path.join(projectPath, 'scenes'), { recursive: true });

      const projectGodot = [
        '; Engine configuration file.',
        "; It's best edited using the editor, not directly.",
        'config_version=5',
        '',
        '[application]',
        'config/name="godot-mcp-omni-smoke"',
        '',
      ].join('\n');
      await fs.writeFile(
        path.join(projectPath, 'project.godot'),
        projectGodot,
        'utf8',
      );
    }
  }

  try {
    await fs.access(path.join(projectPath, 'project.godot'));
  } catch {
    throw new Error(
      `Not a valid Godot project (missing project.godot): ${projectPath}`,
    );
  }

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
      if (shouldCleanupProject)
        await fs.rm(projectPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  server.stderr.on('data', (d: Buffer) => {
    if (debug) process.stderr.write(d);
  });

  try {
    const listResp = await client.send('tools/list', {});
    if ('error' in listResp)
      throw new Error(`tools/list error: ${JSON.stringify(listResp.error)}`);

    const smokeScenePath = '.godot_mcp/smoke/Smoke.tscn';
    const receiverScriptPath = '.godot_mcp/smoke/Receiver.gd';

    await client.callToolOrThrow('create_scene', {
      projectPath,
      scenePath: smokeScenePath,
      rootNodeType: 'Node2D',
    });

    await client.callToolOrThrow('godot_scene_manager', {
      action: 'create',
      projectPath,
      scenePath: smokeScenePath,
      parentNodePath: 'root',
      nodeType: 'Node',
      nodeName: 'Emitter',
      props: {},
    });

    await client.callToolOrThrow('godot_scene_manager', {
      action: 'create',
      projectPath,
      scenePath: smokeScenePath,
      parentNodePath: 'root',
      nodeType: 'Node',
      nodeName: 'Receiver',
      props: {},
    });

    await client.callToolOrThrow('godot_workspace_manager', {
      action: 'save_scene',
      projectPath,
      scenePath: smokeScenePath,
    });

    await client.callToolOrThrow('godot_headless_op', {
      projectPath,
      operation: 'create_script',
      params: {
        scriptPath: receiverScriptPath,
        template: 'minimal',
        extends: 'Node',
      },
    });

    await client.callToolOrThrow('godot_headless_op', {
      projectPath,
      operation: 'attach_script',
      params: {
        scenePath: smokeScenePath,
        nodePath: 'root/Receiver',
        scriptPath: receiverScriptPath,
      },
    });

    await client.callToolOrThrow('godot_headless_op', {
      projectPath,
      operation: 'connect_signal',
      params: {
        scenePath: smokeScenePath,
        fromNodePath: 'root/Emitter',
        signal: 'ready',
        toNodePath: 'root/Receiver',
        method: '_ready',
      },
    });

    const readResp = await client.callToolOrThrow('godot_headless_op', {
      projectPath,
      operation: 'read_text_file',
      params: {
        path: smokeScenePath,
      },
    });

    const sceneText = String(readResp?.details?.content ?? '');
    if (
      !sceneText.includes('signal="ready"') ||
      !sceneText.includes('method="_ready"')
    ) {
      throw new Error(
        `connect_signal did not persist to scene file: ${smokeScenePath}`,
      );
    }

    await client.callToolOrThrow('godot_headless_op', {
      projectPath,
      operation: 'validate_scene',
      params: {
        scenePath: smokeScenePath,
      },
    });

    await client.callToolOrThrow('godot_project_config_manager', {
      action: 'project_info.get',
      projectPath,
    });

    console.log('Smoke test passed.');
  } finally {
    await shutdown();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
