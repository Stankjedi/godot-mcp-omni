import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';

function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function startServer(env = {}) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverEntry = path.join(__dirname, '..', 'build', 'index.js');
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      GODOT_PATH: '',
      ...env,
    },
  });
  return child;
}

async function waitForServerStartup() {
  await new Promise((r) => setTimeout(r, 300));
}

test('godot_preflight returns ok=false when project.godot is missing', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-preflight-missing-');
  const server = startServer();
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const res = await client.callTool('godot_preflight', { projectPath });
    assert.equal(res.ok, false);
    assert.match(res.summary, /Preflight failed/u);
    assert.equal(res.details?.checks?.project?.status, 'error');
    assert.match(
      String(res.details?.checks?.project?.reason ?? ''),
      /project\.godot/u,
    );
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('godot_preflight returns ok=true for a minimal project (Godot check skipped)', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-preflight-ok-');
  writeMinimalProject(projectPath, 'godot-mcp-omni-preflight-test');

  const server = startServer();
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const res = await client.callToolOrThrow('godot_preflight', {
      projectPath,
    });
    assert.equal(res.ok, true);
    assert.equal(res.details?.checks?.project?.status, 'ok');
    assert.equal(res.details?.checks?.godot?.status, 'skipped');
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});
