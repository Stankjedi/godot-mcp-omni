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
  assert.ok(Array.isArray(json.groups?.meta));
  assert.ok(json.tools.includes('meta_tool_manager'));
  assert.ok(!json.tools.includes('server_info'));
  assert.ok(!Object.prototype.hasOwnProperty.call(json.groups ?? {}, 'server'));

  assert.deepEqual(
    [...json.tools].sort((a, b) => a.localeCompare(b)),
    json.tools,
  );
  for (const groupName of Object.keys(json.groups ?? {})) {
    const tools = json.groups[groupName];
    if (!Array.isArray(tools)) continue;
    assert.deepEqual(
      [...tools].sort((a, b) => a.localeCompare(b)),
      tools,
    );
  }
});

test('CLI --list-tools-full-json prints JSON-only output and exits 0', () => {
  const res = spawnSync(
    process.execPath,
    [buildIndexPath, '--list-tools-full-json'],
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
  assert.ok(Array.isArray(json.groups?.meta));

  const meta = json.tools.find((t) => t?.name === 'meta_tool_manager') ?? null;
  assert.ok(meta && typeof meta === 'object', 'meta_tool_manager must exist');
  assert.ok(meta.inputSchema, 'inputSchema must be present');

  for (const t of json.tools) {
    assert.equal(typeof t?.name, 'string');
  }

  const toolNames = json.tools.map((t) => t.name);
  assert.deepEqual(
    [...toolNames].sort((a, b) => a.localeCompare(b)),
    toolNames,
  );

  for (const groupName of Object.keys(json.groups ?? {})) {
    const tools = json.groups[groupName];
    if (!Array.isArray(tools)) continue;
    assert.deepEqual(
      [...tools].sort((a, b) => a.localeCompare(b)),
      tools,
    );
  }
});

test('CLI --tool-schema prints JSON-only output and exits 0', () => {
  const res = spawnSync(
    process.execPath,
    [buildIndexPath, '--tool-schema', 'meta_tool_manager'],
    {
      encoding: 'utf8',
      env: { ...process.env, GODOT_PATH: '' },
    },
  );

  assert.equal(res.status, 0);
  assert.equal(res.stderr.trim(), '');

  const json = JSON.parse(res.stdout);
  assert.ok(json && typeof json === 'object' && !Array.isArray(json));

  assert.equal(json.ok, true);
  assert.equal(json.tool?.name, 'meta_tool_manager');
  assert.equal(json.group, 'meta');
  assert.ok(json.tool?.inputSchema, 'inputSchema must be present');
});

test('CLI --tool-schema prints JSON-only error output and exits non-zero when tool is missing', () => {
  const res = spawnSync(
    process.execPath,
    [buildIndexPath, '--tool-schema', 'does_not_exist'],
    {
      encoding: 'utf8',
      env: { ...process.env, GODOT_PATH: '' },
    },
  );

  assert.equal(res.status, 1);
  assert.equal(res.stderr.trim(), '');

  const json = JSON.parse(res.stdout);
  assert.ok(json && typeof json === 'object' && !Array.isArray(json));

  assert.equal(json.ok, false);
  assert.equal(json.error?.code, 'E_NOT_FOUND');
  assert.match(json.error?.message ?? '', /Unknown tool:/u);
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

test('CLI --doctor-report prints JSON-only output and writes a report (CI-safe)', async () => {
  const projectPath = await fs.mkdtemp(
    path.join(os.tmpdir(), 'godot-mcp-omni-cli-doctor-report-'),
  );

  try {
    const projectGodotPath = path.join(projectPath, 'project.godot');
    const projectGodot = [
      '; Engine configuration file.',
      "; It's best edited using the editor, not directly.",
      'config_version=5',
      '',
      '[application]',
      'config/name="DoctorReportCliProject"',
      '',
    ].join('\n');
    await fs.writeFile(projectGodotPath, projectGodot, 'utf8');

    const res = spawnSync(
      process.execPath,
      [buildIndexPath, '--doctor-report', '--project', projectPath],
      {
        encoding: 'utf8',
        env: { ...process.env, GODOT_PATH: '' },
      },
    );

    assert.equal(res.status, 1, 'Expected environment-related doctor errors');
    assert.equal(res.stderr.trim(), '');

    const json = JSON.parse(res.stdout.trim());
    assert.equal(typeof json.reportPath, 'string');
    assert.ok(json.reportPath.startsWith(projectPath));

    const markdown = await fs.readFile(json.reportPath, 'utf8');
    assert.match(markdown, /Generated by godot-mcp-omni doctor_report\./u);
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
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
