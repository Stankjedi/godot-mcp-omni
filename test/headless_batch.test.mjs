import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';
import {
  mkdtemp,
  startServer,
  waitForServerStartup,
  writeMinimalProject,
} from './helpers.mjs';

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
