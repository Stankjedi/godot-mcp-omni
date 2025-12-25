import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { detectGodotPath, isValidGodotPath } from './godot_cli.js';
import { JsonRpcProcessClient } from './utils/jsonrpc_process_client.js';

async function main() {
  const debug = process.env.SAFETY_DEBUG === 'true';

  const godotPath = await detectGodotPath({
    strictPathValidation: true,
    debug: debug ? (m) => console.error(`[verify:safety] ${m}`) : undefined,
  });

  const cache = new Map<string, boolean>();
  const ok = await isValidGodotPath(godotPath, cache);
  if (!ok) {
    throw new Error(
      `Godot executable is not valid: ${godotPath}\n` +
        `Set GODOT_PATH to a working Godot binary, or ensure 'godot --version' succeeds.`,
    );
  }

  const projectPath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'godot-mcp-omni-safety-'),
  );
  await fs.mkdir(path.join(projectPath, 'scenes'), { recursive: true });

  const projectGodot = [
    '; Engine configuration file.',
    "; It's best edited using the editor, not directly.",
    'config_version=5',
    '',
    '[application]',
    'config/name="godot-mcp-omni-safety"',
    '',
  ].join('\n');
  await fs.writeFile(
    path.join(projectPath, 'project.godot'),
    projectGodot,
    'utf8',
  );

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverEntry = path.join(__dirname, 'index.js');

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

    const callTool = async (name: string, args: Record<string, unknown>) =>
      await client.callTool(name, args);

    // 0) Validation: missing required args should fail fast with a structured error.
    const invalidArgsResp = await callTool('godot_headless_op', {
      operation: 'write_text_file',
      params: { path: 'res://scenes/invalid.txt', content: 'blocked' },
    });
    if (
      invalidArgsResp?.ok !== false ||
      typeof invalidArgsResp?.summary !== 'string' ||
      !invalidArgsResp.summary.startsWith('Invalid arguments:') ||
      invalidArgsResp?.details?.field !== 'projectPath'
    ) {
      throw new Error(
        `Expected validation failure for missing projectPath. Got: ${JSON.stringify(invalidArgsResp, null, 2)}`,
      );
    }

    // 1) Path allowlist: attempt to escape project root should be blocked.
    const outsideWrite = await callTool('godot_headless_op', {
      projectPath,
      operation: 'write_text_file',
      params: { path: '../outside.txt', content: 'blocked' },
    });
    if (
      outsideWrite?.ok !== false ||
      typeof outsideWrite?.summary !== 'string' ||
      !outsideWrite.summary.includes('Path escapes project root')
    ) {
      throw new Error(
        `Expected outside write to be blocked. Got: ${JSON.stringify(outsideWrite, null, 2)}`,
      );
    }

    // 2) Dangerous ops gating: export/build/delete-like ops require ALLOW_DANGEROUS_OPS=true.
    const exportAttempt = await callTool('godot_headless_op', {
      projectPath,
      operation: 'export_mesh_library',
      params: {},
    });
    if (
      exportAttempt?.ok !== false ||
      typeof exportAttempt?.summary !== 'string' ||
      !exportAttempt.summary.includes('Dangerous operation blocked')
    ) {
      throw new Error(
        `Expected dangerous op to be blocked. Got: ${JSON.stringify(exportAttempt, null, 2)}`,
      );
    }

    // 3) Audit log should exist and contain entries.
    const auditPath = path.join(projectPath, '.godot_mcp', 'audit.log');
    const auditText = await fs.readFile(auditPath, 'utf8');
    if (!auditText.includes('"tool":"godot_headless_op"')) {
      throw new Error(`Audit log missing expected entries: ${auditPath}`);
    }

    console.log('Safety verification passed.');
  } finally {
    await shutdown();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
