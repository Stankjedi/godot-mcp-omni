import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scriptPath = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'cleanup_tmp.js',
);

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

test('cleanup_tmp removes only target directory contents', async () => {
  const outer = await fs.mkdtemp(
    path.join(os.tmpdir(), 'godot-mcp-omni-cleanup-tmp-'),
  );
  const targetDir = path.join(outer, 'target');
  const sentinelPath = path.join(outer, 'sentinel.txt');

  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(sentinelPath, 'sentinel', 'utf8');

    await fs.writeFile(path.join(targetDir, 'a.txt'), 'a', 'utf8');
    await fs.mkdir(path.join(targetDir, 'nested'), { recursive: true });
    await fs.writeFile(path.join(targetDir, 'nested', 'b.txt'), 'b', 'utf8');

    const res = spawnSync(process.execPath, [scriptPath, '--dir', targetDir], {
      encoding: 'utf8',
    });

    assert.equal(
      res.status,
      0,
      `Expected exit 0, got ${res.status}\n\nSTDOUT:\n${res.stdout}\n\nSTDERR:\n${res.stderr}`,
    );

    assert.equal(
      await pathExists(sentinelPath),
      true,
      'Expected sentinel file to remain',
    );

    if (await pathExists(targetDir)) {
      const remaining = await fs.readdir(targetDir);
      assert.deepEqual(remaining, []);
    }
  } finally {
    await fs.rm(outer, { recursive: true, force: true });
  }
});
