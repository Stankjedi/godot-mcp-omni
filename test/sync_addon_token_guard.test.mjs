import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';
import {
  mkdtemp,
  startServer,
  waitForServerStartup,
  writeMinimalProject,
} from './helpers.mjs';

test('godot_sync_addon ensures .godot_mcp_token exists (CI-safe)', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-sync-addon-token-');
  const tokenPath = path.join(projectPath, '.godot_mcp_token');

  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    writeMinimalProject(projectPath, 'sync-addon-token-guard');
    assert.equal(fs.existsSync(tokenPath), false);

    await waitForServerStartup();

    const first = await client.callToolOrThrow('godot_sync_addon', {
      projectPath,
      enablePlugin: true,
      ensureToken: true,
    });

    assert.equal(first.ok, true);
    assert.equal(fs.existsSync(tokenPath), true);
    const tokenFile = fs.readFileSync(tokenPath, 'utf8');
    assert.ok(tokenFile.trim().length > 0);
    assert.ok(tokenFile.endsWith('\n'));
    assert.equal(first.details?.tokenCreated, true);

    const second = await client.callToolOrThrow('godot_sync_addon', {
      projectPath,
      enablePlugin: true,
      ensureToken: true,
    });

    assert.equal(second.ok, true);
    const tokenFileAfter = fs.readFileSync(tokenPath, 'utf8');
    assert.equal(tokenFileAfter, tokenFile);
    assert.equal(second.details?.tokenUpdated, false);
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});
