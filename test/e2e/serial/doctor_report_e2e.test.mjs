import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { JsonRpcProcessClient } from '../../../build/utils/jsonrpc_process_client.js';
import {
  mkdtemp,
  resolveResPath,
  startServer,
  waitForServerStartup,
  writeMinimalProject,
} from '../helpers.mjs';

function writeFileRes(projectPath, resPath, content) {
  const abs = resolveResPath(projectPath, resPath);
  assert.ok(abs, `Invalid res path: ${resPath}`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

test('doctor_report blocks reportRelativePath traversal (CI-safe)', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-doctor-report-path-');
  writeMinimalProject(projectPath, 'DoctorReportPathTest', null);

  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const resp = await client.callTool('godot_workspace_manager', {
      action: 'doctor_report',
      projectPath,
      reportRelativePath: '../outside.md',
    });
    assert.equal(resp.ok, false);
    assert.match(
      String(resp.summary ?? ''),
      /reportRelativePath|escapes project root/u,
    );
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('doctor_report creates and truncates a markdown report (CI-safe)', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-doctor-report-ci-safe-');
  writeMinimalProject(projectPath, 'DoctorReportCiSafe', null);

  const server = startServer({ GODOT_PATH: '' });
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();

    const resp = await client.callToolOrThrow('godot_workspace_manager', {
      action: 'doctor_report',
      projectPath,
    });

    assert.equal(resp.ok, true);
    assert.equal(typeof resp.details?.reportPath, 'string');

    const reportPath = resp.details.reportPath;
    assert.ok(fs.existsSync(reportPath), 'report file not created');

    const first = fs.readFileSync(reportPath, 'utf8');
    assert.match(first, /# Doctor Report/u);
    assert.match(first, /(GODOT_VERSION_UNAVAILABLE|DOCTOR_SCAN_FAILED)/u);

    // Truncate/replace behavior (no append).
    fs.writeFileSync(reportPath, 'SENTINEL\n', 'utf8');
    const resp2 = await client.callToolOrThrow('godot_workspace_manager', {
      action: 'doctor_report',
      projectPath,
    });
    assert.equal(resp2.ok, true);
    const second = fs.readFileSync(reportPath, 'utf8');
    assert.ok(!second.includes('SENTINEL'), 'report was not truncated');
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test(
  'doctor_report generates and truncates a markdown report (headless)',
  { skip: !process.env.GODOT_PATH },
  async () => {
    const projectPath = mkdtemp('godot-mcp-omni-doctor-report-e2e-');
    writeMinimalProject(
      projectPath,
      'DoctorReportE2E',
      'res://scenes/Main.tscn',
    );

    // Intentional issues:
    // 1) Broken script (parse error)
    writeFileRes(
      projectPath,
      'res://scripts/Broken.gd',
      'extends Node\nfunc _ready() -> void\n\tpass\n',
    );

    // 2) Missing res:// reference + uid:// reference
    writeFileRes(
      projectPath,
      'res://scenes/Main.tscn',
      [
        '[gd_scene load_steps=2 format=3]',
        '',
        '[ext_resource type="Texture2D" path="res://assets/missing.png" id="1"]',
        '[ext_resource type="Resource" path="uid://deadbeefdeadbeef" id="2"]',
        '',
        '[node name="Root" type="Node"]',
        '',
      ].join('\n'),
    );

    // 3) Import metadata points to missing source_file
    writeFileRes(
      projectPath,
      'res://assets/missing.png.import',
      'source_file="res://assets/missing.png"\n',
    );

    const server = startServer({ GODOT_PATH: process.env.GODOT_PATH });
    const client = new JsonRpcProcessClient(server);

    try {
      await waitForServerStartup();

      const resp = await client.callToolOrThrow('godot_workspace_manager', {
        action: 'doctor_report',
        projectPath,
        options: {
          timeBudgetMs: 120000,
          maxIssuesPerCategory: 200,
          deepSceneInstantiate: false,
        },
      });

      assert.equal(resp.ok, true);
      assert.equal(typeof resp.details?.reportPath, 'string');

      const reportPath = resp.details.reportPath;
      assert.ok(fs.existsSync(reportPath), 'report file not created');

      const first = fs.readFileSync(reportPath, 'utf8');
      assert.match(first, /# Doctor Report/u);
      assert.match(first, /SCRIPT_PARSE_ERROR/u);
      assert.match(first, /MISSING_RES_REFERENCE/u);
      assert.match(first, /IMPORT_SOURCE_MISSING/u);
      assert.match(first, /UID_UNRECOGNIZED/u);

      // Truncate/replace behavior (no append).
      fs.writeFileSync(reportPath, 'SENTINEL\n', 'utf8');
      const resp2 = await client.callToolOrThrow('godot_workspace_manager', {
        action: 'doctor_report',
        projectPath,
      });
      assert.equal(resp2.ok, true);
      const second = fs.readFileSync(reportPath, 'utf8');
      assert.ok(!second.includes('SENTINEL'), 'report was not truncated');
    } finally {
      client.dispose();
      server.kill();
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  },
);
