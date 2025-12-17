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

  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'godot-mcp-omni-smoke-'));
  await fs.mkdir(path.join(projectPath, 'scenes'), { recursive: true });

  const projectGodot = [
    '; Engine configuration file.',
    '; It\'s best edited using the editor, not directly.',
    'config_version=5',
    '',
    '[application]',
    'config/name="godot-mcp-omni-smoke"',
    '',
  ].join('\n');
  await fs.writeFile(path.join(projectPath, 'project.godot'), projectGodot, 'utf8');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverEntry = path.join(__dirname, 'index.js');

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
      await fs.rm(projectPath, { recursive: true, force: true });
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
    if (!parsed?.ok) throw new Error(`Tool ${name} failed: ${parsed?.summary ?? 'Unknown error'}`);
    return parsed;
  };

  try {
    const listResp = await send('tools/list', {});
    if ('error' in listResp) throw new Error(`tools/list error: ${JSON.stringify(listResp.error)}`);

    await callTool('create_scene', {
      projectPath,
      scenePath: 'scenes/Smoke.tscn',
      rootNodeType: 'Node2D',
    });

    await callTool('add_node', {
      projectPath,
      scenePath: 'scenes/Smoke.tscn',
      parentNodePath: 'root',
      nodeType: 'Node',
      nodeName: 'TestNode',
      properties: {},
    });

    await callTool('save_scene', {
      projectPath,
      scenePath: 'scenes/Smoke.tscn',
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

