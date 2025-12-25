import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';

function mkdtemp(prefix) {
  const godotPath = process.env.GODOT_PATH ?? '';
  const needsWslWinPathTranslation =
    process.platform !== 'win32' && godotPath.toLowerCase().endsWith('.exe');
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

test('godot_headless_batch rejects invalid steps type (CI-safe)', async () => {
  const server = startServer();
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();

    const res = await client.callTool('godot_headless_batch', {
      projectPath: '/tmp/does-not-matter',
      steps: 'not-an-array',
    });

    assert.equal(res.ok, false);
    assert.match(res.summary, /^Invalid arguments:/u);
    assert.equal(res.details?.tool, 'godot_headless_batch');
    assert.equal(res.details?.field, 'steps');
  } finally {
    client.dispose();
    server.kill();
  }
});

test(
  'godot_headless_batch integration: write_text_file then read_text_file',
  { skip: process.env.GODOT_PATH ? false : 'GODOT_PATH not set' },
  async () => {
    const projectPath = mkdtemp('godot-mcp-omni-batch-');
    const server = startServer({
      GODOT_PATH: process.env.GODOT_PATH,
      ALLOW_DANGEROUS_OPS: 'true',
    });
    const client = new JsonRpcProcessClient(server);

    try {
      writeMinimalProject(projectPath, 'godot-mcp-omni-batch-test');
      await waitForServerStartup();

      const res = await client.callToolOrThrow('godot_headless_batch', {
        projectPath,
        steps: [
          {
            operation: 'write_text_file',
            params: { path: 'tmp/hello.txt', content: 'hello' },
          },
          { operation: 'read_text_file', params: { path: 'tmp/hello.txt' } },
        ],
      });

      assert.equal(res.ok, true);
      assert.ok(Array.isArray(res.details?.results));
      assert.equal(res.details.results.length, 2);
      assert.equal(res.details.results[0].ok, true);
      assert.equal(res.details.results[1].ok, true);
      assert.equal(res.details.results[1].details.content, 'hello');
    } finally {
      client.dispose();
      server.kill();
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  },
);
