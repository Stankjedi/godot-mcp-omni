import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MCP_SERVER_INFO } from '../build/server_info.js';
import { PACKAGE_VERSION } from '../build/version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.join(__dirname, '..');
const pluginCfgPath = path.join(
  repoRoot,
  'addons',
  'godot_mcp_bridge',
  'plugin.cfg',
);
const rpcHandlersPath = path.join(
  repoRoot,
  'addons',
  'godot_mcp_bridge',
  'rpc_handlers.gd',
);
const readmePath = path.join(repoRoot, 'README.md');

function extractVersion(label, regex, text) {
  const match = regex.exec(text);
  if (!match?.[1]) {
    assert.fail(`${label}: failed to extract version`);
  }
  return match[1];
}

function unique(items) {
  return [...new Set(items)];
}

test('Release version strings stay in sync (package/server/addon/README)', async () => {
  const pluginCfg = await fs.readFile(pluginCfgPath, 'utf8');
  const rpcHandlers = await fs.readFile(rpcHandlersPath, 'utf8');
  const readme = await fs.readFile(readmePath, 'utf8');

  const addonPluginCfgVersion = extractVersion(
    'plugin.cfg version',
    /version="([^"]+)"/u,
    pluginCfg,
  );
  const addonHandlersVersion = extractVersion(
    'rpc_handlers.gd PLUGIN_VERSION',
    /PLUGIN_VERSION\s*:=\s*"([^"]+)"/u,
    rpcHandlers,
  );

  const readmeVersions = [];
  const readmeVersionRe = /\bv(\d+\.\d+\.\d+)\b/gu;
  for (const match of readme.matchAll(readmeVersionRe)) {
    readmeVersions.push(match[1]);
  }

  assert.ok(
    readmeVersions.length > 0,
    'README.md must contain at least one vX.Y.Z token',
  );

  const readmeUniqueVersions = unique(readmeVersions);

  const all = {
    packageJson: PACKAGE_VERSION,
    serverMetadata: MCP_SERVER_INFO.version,
    addonPluginCfg: addonPluginCfgVersion,
    addonHandlers: addonHandlersVersion,
    readme: readmeUniqueVersions.join(', '),
  };

  const mismatches = [];
  for (const [k, v] of Object.entries(all)) {
    if (k === 'readme') {
      if (!readmeUniqueVersions.every((rv) => rv === PACKAGE_VERSION)) {
        mismatches.push(`${k}=${v}`);
      }
      continue;
    }
    if (v !== PACKAGE_VERSION) mismatches.push(`${k}=${v}`);
  }

  if (mismatches.length > 0) {
    assert.fail(
      `Version drift detected (expected ${PACKAGE_VERSION}): ${mismatches.join(
        '; ',
      )}`,
    );
  }
});
