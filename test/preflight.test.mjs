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

const CI_SAFE_ENV = { GODOT_PATH: '' };

test('godot_preflight returns ok=false when project.godot is missing', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-preflight-missing-');
  const server = startServer(CI_SAFE_ENV);
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const res = await client.callTool('godot_preflight', { projectPath });
    assert.equal(res.ok, false);
    assert.match(res.summary, /Preflight failed/u);
    assert.equal(res.details?.checks?.project?.status, 'error');
    assert.match(
      String(res.details?.checks?.project?.reason ?? ''),
      /project\.godot/u,
    );
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('godot_preflight returns ok=true for a minimal project (Godot check skipped)', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-preflight-ok-');
  writeMinimalProject(projectPath, 'godot-mcp-omni-preflight-test');

  const server = startServer(CI_SAFE_ENV);
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const res = await client.callToolOrThrow('godot_preflight', {
      projectPath,
    });
    assert.equal(res.ok, true);
    assert.equal(res.details?.checks?.project?.status, 'ok');
    assert.equal(res.details?.checks?.godot?.status, 'skipped');
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

function writeMinimalAddon(projectPath) {
  const addonDir = path.join(projectPath, 'addons', 'godot_mcp_bridge');
  fs.mkdirSync(addonDir, { recursive: true });

  const pluginCfg = [
    '[plugin]',
    '',
    'name="Godot MCP Bridge"',
    'description="MCP bridge plugin"',
    'author="godot-mcp-omni"',
    'version="1.0.0"',
    'script="plugin.gd"',
  ].join('\n');

  fs.writeFileSync(path.join(addonDir, 'plugin.cfg'), pluginCfg, 'utf8');
  fs.writeFileSync(
    path.join(addonDir, 'plugin.gd'),
    '@tool\nextends EditorPlugin\n',
    'utf8',
  );
}

function enableAddonInProject(projectPath) {
  const projectGodotPath = path.join(projectPath, 'project.godot');
  let content = fs.readFileSync(projectGodotPath, 'utf8');
  // The isEditorPluginEnabled function checks if enabled array includes 'godot_mcp_bridge'
  // directly (not the full path), so write just the plugin ID
  content +=
    '\n[editor_plugins]\n\nenabled=PackedStringArray("godot_mcp_bridge")\n';
  fs.writeFileSync(projectGodotPath, content, 'utf8');
}

test('godot_preflight detects addon as disabled when present but not enabled', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-preflight-addon-disabled-');
  writeMinimalProject(projectPath, 'preflight-addon-disabled-test');
  writeMinimalAddon(projectPath);

  const server = startServer(CI_SAFE_ENV);
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const res = await client.callToolOrThrow('godot_preflight', {
      projectPath,
    });
    assert.equal(res.details?.checks?.addon?.status, 'disabled');
    // Suggestions are in details.suggestions array, not addon.suggestion
    const suggestions = res.details?.suggestions ?? [];
    const hasSuggestion = suggestions.some((s) =>
      s.includes('godot_mcp_bridge'),
    );
    assert.ok(
      hasSuggestion,
      'Expected a suggestion mentioning godot_mcp_bridge',
    );
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('godot_preflight detects addon as ok when present and enabled', async () => {
  const projectPath = mkdtemp('godot-mcp-omni-preflight-addon-enabled-');
  writeMinimalProject(projectPath, 'preflight-addon-enabled-test');
  writeMinimalAddon(projectPath);
  enableAddonInProject(projectPath);

  const server = startServer(CI_SAFE_ENV);
  const client = new JsonRpcProcessClient(server);

  try {
    await waitForServerStartup();
    const res = await client.callToolOrThrow('godot_preflight', {
      projectPath,
    });
    assert.equal(res.details?.checks?.addon?.status, 'ok');
  } finally {
    client.dispose();
    server.kill();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});
