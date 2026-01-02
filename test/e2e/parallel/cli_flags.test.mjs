import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildIndexPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'build',
  'index.js',
);
const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');

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

test('CLI --print-mcp-config prints JSON-only output and exits 0', () => {
  const res = spawnSync(
    process.execPath,
    [buildIndexPath, '--print-mcp-config'],
    {
      encoding: 'utf8',
      env: { ...process.env, GODOT_PATH: '' },
    },
  );

  assert.equal(res.status, 0);
  assert.equal(res.stderr.trim(), '');

  const config = JSON.parse(res.stdout);
  assert.ok(config && typeof config === 'object' && !Array.isArray(config));

  assert.equal(config.command, 'node');
  assert.ok(Array.isArray(config.args), 'args must be an array');
  assert.equal(config.args.length, 1);
  assert.equal(typeof config.args[0], 'string');
  assert.ok(path.isAbsolute(config.args[0]), 'args[0] must be absolute');
  assert.ok(!Object.prototype.hasOwnProperty.call(config, 'env'));
});

test('CLI --print-mcp-config uses --godot-path and overrides GODOT_PATH', () => {
  const fakeGodotPath = '/fake/path/to/godot';

  const res = spawnSync(
    process.execPath,
    [buildIndexPath, '--print-mcp-config', '--godot-path', fakeGodotPath],
    {
      encoding: 'utf8',
      env: { ...process.env, GODOT_PATH: '/ignored/by-cli' },
    },
  );

  assert.equal(res.status, 0);
  assert.equal(res.stderr.trim(), '');

  const config = JSON.parse(res.stdout);
  assert.ok(config && typeof config === 'object' && !Array.isArray(config));

  assert.equal(config.command, 'node');
  assert.ok(Array.isArray(config.args), 'args must be an array');
  assert.equal(config.args.length, 1);
  assert.equal(typeof config.args[0], 'string');
  assert.ok(path.isAbsolute(config.args[0]), 'args[0] must be absolute');

  assert.ok(
    config.env && typeof config.env === 'object' && !Array.isArray(config.env),
  );
  assert.equal(config.env.GODOT_PATH, fakeGodotPath);
});
