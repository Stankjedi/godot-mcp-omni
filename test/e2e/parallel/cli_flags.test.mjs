import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
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

test('CLI --list-tools prints tool names and exits 0', () => {
  const res = spawnSync(process.execPath, [buildIndexPath, '--list-tools'], {
    encoding: 'utf8',
    env: { ...process.env, GODOT_PATH: '' },
  });

  assert.equal(res.status, 0);
  assert.match(res.stdout, /Total tools:/u);
  assert.match(res.stdout, /\bgodot_workspace_manager\b/u);
  assert.ok(!res.stderr.includes('server running on stdio'));
});

test('CLI --list-tools-json prints JSON-only output and exits 0', () => {
  const res = spawnSync(
    process.execPath,
    [buildIndexPath, '--list-tools-json'],
    {
      encoding: 'utf8',
      env: { ...process.env, GODOT_PATH: '' },
    },
  );

  assert.equal(res.status, 0);
  assert.equal(res.stderr.trim(), '');

  const json = JSON.parse(res.stdout);
  assert.ok(json && typeof json === 'object' && !Array.isArray(json));

  assert.equal(typeof json.total, 'number');
  assert.ok(Array.isArray(json.tools));
  assert.ok(Array.isArray(json.groups?.server));
  assert.ok(json.tools.includes('server_info'));

  assert.deepEqual([...json.tools].sort((a, b) => a.localeCompare(b)), json.tools);
  for (const groupName of Object.keys(json.groups ?? {})) {
    const tools = json.groups[groupName];
    if (!Array.isArray(tools)) continue;
    assert.deepEqual([...tools].sort((a, b) => a.localeCompare(b)), tools);
  }
});

test('CLI --list-tools rejects incompatible flag combinations', () => {
  const res = spawnSync(
    process.execPath,
    [buildIndexPath, '--list-tools', '--doctor'],
    {
      encoding: 'utf8',
      env: { ...process.env, GODOT_PATH: '' },
    },
  );

  assert.equal(res.status, 1);
  assert.match(res.stderr, /--list-tools cannot be combined/u);
});

test('CLI --doctor-readonly does not modify project files', async () => {
  const projectPath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'godot-mcp-omni-cli-doctor-readonly-'),
  );

  try {
    const projectGodotPath = path.join(projectPath, 'project.godot');
    const beforeProjectGodot = [
      '; Engine configuration file.',
      "; It's best edited using the editor, not directly.",
      'config_version=5',
      '',
      '[application]',
      'config/name="DoctorReadOnlyProject"',
      '',
    ].join('\n');
    await fs.writeFile(projectGodotPath, beforeProjectGodot, 'utf8');

    const res = spawnSync(
      process.execPath,
      [
        buildIndexPath,
        '--doctor',
        '--doctor-readonly',
        '--json',
        '--project',
        projectPath,
        '--godot-path',
        '/definitely/invalid',
      ],
      { encoding: 'utf8' },
    );

    assert.notEqual(res.status, 0);
    const json = JSON.parse(res.stdout.trim());
    assert.equal(json.details?.checks?.projectSetup?.skipped, true);

    const afterProjectGodot = await fs.readFile(projectGodotPath, 'utf8');
    assert.equal(afterProjectGodot, beforeProjectGodot);

    const mustNotExist = [
      path.join(projectPath, '.godot_mcp_token'),
      path.join(projectPath, '.godot_mcp_host'),
      path.join(projectPath, '.godot_mcp_port'),
      path.join(projectPath, 'addons', 'godot_mcp_bridge'),
    ];

    for (const p of mustNotExist) {
      await assert.rejects(fs.access(p));
    }
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});
