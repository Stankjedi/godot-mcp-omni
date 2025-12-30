import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildIndexPath = path.join(__dirname, '..', 'build', 'index.js');
const packageJsonPath = path.join(__dirname, '..', 'package.json');

test('CLI --help prints usage and exits 0', () => {
  const res = spawnSync(process.execPath, [buildIndexPath, '--help'], {
    encoding: 'utf8',
  });

  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage:/u);
  assert.ok(!res.stderr.includes('server running on stdio'));
});

test('CLI --version prints package version and exits 0', async () => {
  const raw = await fs.readFile(packageJsonPath, 'utf8');
  const pkg = JSON.parse(raw);
  assert.equal(typeof pkg.version, 'string');

  const res = spawnSync(process.execPath, [buildIndexPath, '--version'], {
    encoding: 'utf8',
  });

  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), pkg.version);
  assert.equal(res.stderr.trim(), '');
});
