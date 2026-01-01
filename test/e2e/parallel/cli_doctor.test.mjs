import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { mkdtemp, writeMinimalProject } from '../helpers.mjs';

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

test('CLI --doctor fails with invalid --godot-path', () => {
  const res = spawnSync(
    process.execPath,
    [buildIndexPath, '--doctor', '--godot-path', '/definitely/invalid'],
    { encoding: 'utf8' },
  );

  assert.notEqual(res.status, 0);
  const combined = `${res.stdout}\n${res.stderr}`.trim();
  assert.match(combined, /DOCTOR FAIL/u);
  assert.match(combined, /Strict path validation: false/u);
  assert.match(combined, /Godot/u);
  assert.match(combined, /not valid/u);
});

test('CLI --doctor prints strict path validation when enabled', () => {
  const res = spawnSync(
    process.execPath,
    [
      buildIndexPath,
      '--doctor',
      '--strict-path-validation',
      '--godot-path',
      '/definitely/invalid',
    ],
    { encoding: 'utf8' },
  );

  assert.notEqual(res.status, 0);
  const combined = `${res.stdout}\n${res.stderr}`.trim();
  assert.match(combined, /Strict path validation: true/u);
});

test('CLI --doctor --json prints JSON-only output and exits non-zero on failure', () => {
  const res = spawnSync(
    process.execPath,
    [
      buildIndexPath,
      '--doctor',
      '--json',
      '--godot-path',
      '/definitely/invalid',
    ],
    { encoding: 'utf8' },
  );

  assert.notEqual(res.status, 0);

  const raw = res.stdout.trim();
  assert.ok(raw.length > 0, 'expected stdout to contain JSON');

  const json = JSON.parse(raw);
  assert.equal(json.ok, false);
  assert.ok(json.details, 'expected JSON to have details');
  assert.ok(json.details.godot, 'expected JSON to have details.godot');
  assert.ok(json.details.checks, 'expected JSON to have details.checks');
  assert.ok(
    typeof json.details.checks.mcpServer?.ok === 'boolean',
    'expected JSON to include checks.mcpServer.ok',
  );
});

test('CLI --doctor --project reports .godot_mcp_host as non-fatal (text + JSON)', () => {
  const projectPath = mkdtemp('godot-mcp-omni-cli-doctor-project-');
  try {
    writeMinimalProject(projectPath, 'DoctorProject');

    const resText = spawnSync(
      process.execPath,
      [
        buildIndexPath,
        '--doctor',
        '--project',
        projectPath,
        '--godot-path',
        '/definitely/invalid',
      ],
      { encoding: 'utf8' },
    );

    assert.notEqual(resText.status, 0);
    const combined = `${resText.stdout}\n${resText.stderr}`.trim();
    assert.match(combined, /Project: OK/u);
    assert.match(combined, /\.godot_mcp_host: MISSING \(non-fatal\)/u);

    const resJson = spawnSync(
      process.execPath,
      [
        buildIndexPath,
        '--doctor',
        '--json',
        '--project',
        projectPath,
        '--godot-path',
        '/definitely/invalid',
      ],
      { encoding: 'utf8' },
    );

    assert.notEqual(resJson.status, 0);
    const json = JSON.parse(resJson.stdout.trim());
    assert.ok(
      json.details?.project,
      'expected JSON to include details.project',
    );
    assert.equal(json.details.project.hasHostFile, false);
    assert.equal(json.details.project.hasBridgeAddon, true);
    assert.equal(json.details.project.hasBridgePluginEnabled, true);
    assert.equal(json.details.project.hasTokenFile, true);
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('CLI --doctor --project auto-sets up bridge addon + plugin + token', () => {
  const projectPath = mkdtemp('godot-mcp-omni-cli-doctor-project-plugins-');
  try {
    writeMinimalProject(projectPath, 'DoctorProjectPlugins');

    const resJson = spawnSync(
      process.execPath,
      [
        buildIndexPath,
        '--doctor',
        '--json',
        '--project',
        projectPath,
        '--godot-path',
        '/definitely/invalid',
      ],
      { encoding: 'utf8' },
    );

    assert.notEqual(resJson.status, 0);
    const json = JSON.parse(resJson.stdout.trim());
    assert.ok(
      json.details?.checks?.projectSetup,
      'expected JSON to include details.checks.projectSetup',
    );
    assert.equal(json.details.checks.projectSetup.ok, true);

    assert.ok(
      json.details?.project,
      'expected JSON to include details.project',
    );
    assert.equal(json.details.project.hasBridgeAddon, true);
    assert.equal(json.details.project.hasBridgePluginEnabled, true);
    assert.equal(json.details.project.hasTokenFile, true);
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});
