import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import crypto from 'crypto';
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

async function ensureTempProjectHasAddon(projectPath: string, repoRoot: string): Promise<void> {
  const srcAddon = path.join(repoRoot, 'addons', 'godot_mcp_bridge');
  const dstAddon = path.join(projectPath, 'addons', 'godot_mcp_bridge');
  await fs.mkdir(path.dirname(dstAddon), { recursive: true });
  await fs.cp(srcAddon, dstAddon, { recursive: true, force: true });
}

async function writeMinimalProject(projectPath: string, enablePlugin: boolean): Promise<void> {
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

  await fs.writeFile(path.join(projectPath, 'project.godot'), lines.join('\n'), 'utf8');
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
        `Set GODOT_PATH to a working Godot binary, or ensure 'godot --version' succeeds.`
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
      throw new Error(`Not a valid Godot project (missing project.godot): ${projectPath}`);
    }
  }

  const token = process.env.DEMO_TOKEN?.trim() || crypto.randomBytes(24).toString('hex');

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
      if (shouldCreateProject) await fs.rm(projectPath, { recursive: true, force: true });
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

    const demoSceneRel = '.godot_mcp/demo/Demo.tscn';
    const demoSceneRes = 'res://.godot_mcp/demo/Demo.tscn';

    await callTool('create_scene', { projectPath, scenePath: demoSceneRel, rootNodeType: 'Node2D' });

    await callTool('godot_connect_editor', { projectPath, token, timeoutMs: 60000 });

    await callTool('godot_rpc', { request_json: { method: 'health', params: {} }, timeoutMs: 10000 });
    await callTool('godot_rpc', { request_json: { method: 'open_scene', params: { path: demoSceneRes } }, timeoutMs: 20000 });

    await callTool('godot_rpc', { request_json: { method: 'begin_action', params: { name: 'demo:add+set' } } });
    await callTool('godot_rpc', {
      request_json: {
        method: 'add_node',
        params: { parent_path: 'root', type: 'Node2D', name: 'BatchNode', props: { unique_name_in_owner: true } },
      },
    });
    await callTool('godot_rpc', {
      request_json: { method: 'set_property', params: { node_path: 'root/BatchNode', property: 'visible', value: false } },
    });
    await callTool('godot_rpc', { request_json: { method: 'commit_action', params: {} } });

    await callTool('godot_rpc', { request_json: { method: 'save_scene', params: {} }, timeoutMs: 20000 });

    await callTool('godot_rpc', { request_json: { method: 'filesystem.scan', params: {} }, timeoutMs: 20000 });
    await callTool('godot_rpc', {
      request_json: { method: 'filesystem.reimport_files', params: { files: [demoSceneRes] } },
      timeoutMs: 20000,
    });

    await callTool('godot_inspect', { query_json: { class_name: 'Node2D' }, timeoutMs: 20000 });
    await callTool('godot_inspect', { query_json: { node_path: '%BatchNode' }, timeoutMs: 20000 });

    await callTool('godot_rpc', {
      request_json: {
        method: 'call',
        params: { target_type: 'node', target_id: '%BatchNode', method: 'get_class', args: [] },
      },
    });

    console.log('Editor demo completed.');
    console.log('Undo check: in the editor, press Ctrl/Cmd+Z once. The BatchNode add + visible change should revert together.');
  } finally {
    await shutdown();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

