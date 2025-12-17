import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { spawn } from 'child_process';

import { detectGodotPath, isValidGodotPath } from './godot_cli.js';

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: number; result: unknown }
  | { jsonrpc: '2.0'; id: number; error: unknown };

function getTextContent(mcpResult: any): string {
  if (!mcpResult || !Array.isArray(mcpResult.content)) throw new Error(`Bad MCP result: ${JSON.stringify(mcpResult)}`);
  const text = mcpResult.content.find((c: any) => c?.type === 'text')?.text;
  if (typeof text !== 'string') throw new Error(`Missing text content: ${JSON.stringify(mcpResult)}`);
  return text;
}

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
        `Set GODOT_PATH to a working Godot binary, or ensure 'godot --version' succeeds.`
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
      projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'godot-mcp-omni-smoke-'));
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
      await fs.writeFile(path.join(projectPath, 'project.godot'), projectGodot, 'utf8');
    }
  }

  try {
    await fs.access(path.join(projectPath, 'project.godot'));
  } catch {
    throw new Error(`Not a valid Godot project (missing project.godot): ${projectPath}`);
  }

  const server = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, GODOT_PATH: godotPath, DEBUG: debug ? 'true' : 'false' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const pending = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  let stdoutBuffer = '';

  const shutdown = async () => {
    try {
      server.kill();
    } catch {
      // ignore
    }
    try {
      if (shouldCleanupProject) await fs.rm(projectPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  server.on('exit', (code) => {
    for (const { reject } of pending.values()) reject(new Error(`Server exited (code=${code ?? 'null'})`));
    pending.clear();
  });

  server.stderr.on('data', (d: Buffer) => {
    if (debug) process.stderr.write(d);
  });

  server.stdout.on('data', (d: Buffer) => {
    stdoutBuffer += d.toString('utf8');
    while (true) {
      const idx = stdoutBuffer.indexOf('\n');
      if (idx === -1) break;
      const line = stdoutBuffer.slice(0, idx).trim();
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (!line) continue;

      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      if (typeof msg?.id !== 'number') continue;
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      p.resolve(msg as JsonRpcResponse);
    }
  });

  const send = async (method: string, params: any, timeoutMs = 30000): Promise<JsonRpcResponse> => {
    const id = nextId++;
    const request = { jsonrpc: '2.0', id, method, params };

    if (!server.stdin.writable) throw new Error('Server stdin not writable');
    server.stdin.write(`${JSON.stringify(request)}\n`);

    return await new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${method} (id=${id})`)), timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
    });
  };

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const resp = await send('tools/call', { name, arguments: args });
    if ('error' in resp) throw new Error(`tools/call error: ${JSON.stringify(resp.error)}`);

    const toolText = getTextContent((resp as any).result);
    let parsed: any;
    try {
      parsed = JSON.parse(toolText);
    } catch {
      throw new Error(`Tool ${name} returned non-JSON text: ${toolText}`);
    }
    if (!parsed?.ok) {
      const details = parsed?.details ? `\nDetails: ${JSON.stringify(parsed.details, null, 2)}` : '';
      const logs = parsed?.logs ? `\nLogs: ${JSON.stringify(parsed.logs, null, 2)}` : '';
      throw new Error(`Tool ${name} failed: ${parsed?.summary ?? 'Unknown error'}${details}${logs}`);
    }
    return parsed;
  };

  try {
    const listResp = await send('tools/list', {});
    if ('error' in listResp) throw new Error(`tools/list error: ${JSON.stringify(listResp.error)}`);

    const smokeScenePath = '.godot_mcp/smoke/Smoke.tscn';
    const receiverScriptPath = '.godot_mcp/smoke/Receiver.gd';

    await callTool('create_scene', {
      projectPath,
      scenePath: smokeScenePath,
      rootNodeType: 'Node2D',
    });

    await callTool('add_node', {
      projectPath,
      scenePath: smokeScenePath,
      parentNodePath: 'root',
      nodeType: 'Node',
      nodeName: 'Emitter',
      properties: {},
    });

    await callTool('add_node', {
      projectPath,
      scenePath: smokeScenePath,
      parentNodePath: 'root',
      nodeType: 'Node',
      nodeName: 'Receiver',
      properties: {},
    });

    await callTool('save_scene', {
      projectPath,
      scenePath: smokeScenePath,
    });

    await callTool('godot_headless_op', {
      projectPath,
      operation: 'create_script',
      params: {
        scriptPath: receiverScriptPath,
        template: 'minimal',
        extends: 'Node',
      },
    });

    await callTool('godot_headless_op', {
      projectPath,
      operation: 'attach_script',
      params: {
        scenePath: smokeScenePath,
        nodePath: 'root/Receiver',
        scriptPath: receiverScriptPath,
      },
    });

    await callTool('godot_headless_op', {
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

    const readResp = await callTool('godot_headless_op', {
      projectPath,
      operation: 'read_text_file',
      params: {
        path: smokeScenePath,
      },
    });

    const sceneText = String(readResp?.details?.content ?? '');
    if (!sceneText.includes('signal="ready"') || !sceneText.includes('method="_ready"')) {
      throw new Error(`connect_signal did not persist to scene file: ${smokeScenePath}`);
    }

    await callTool('godot_headless_op', {
      projectPath,
      operation: 'validate_scene',
      params: {
        scenePath: smokeScenePath,
      },
    });

    await callTool('get_project_info', { projectPath });

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
