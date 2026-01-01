import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureEditorPluginEnabled } from '../../../build/tools/project.js';

test('ensureEditorPluginEnabled adds editor plugin section when missing', () => {
  const input = [
    '; Engine configuration file.',
    'config_version=5',
    '',
    '[application]',
    'config/name="demo"',
    '',
  ].join('\n');

  const output = ensureEditorPluginEnabled(input, 'godot_mcp_bridge');

  assert.match(output, /\[editor_plugins\]/u);
  assert.match(output, /enabled=PackedStringArray\("godot_mcp_bridge"\)/u);
});

test('ensureEditorPluginEnabled is idempotent and preserves existing entries', () => {
  const input = [
    '; Engine configuration file.',
    'config_version=5',
    '',
    '[editor_plugins]',
    'enabled=PackedStringArray("first_plugin")',
    '',
  ].join('\n');

  const first = ensureEditorPluginEnabled(input, 'godot_mcp_bridge');
  const second = ensureEditorPluginEnabled(first, 'godot_mcp_bridge');

  assert.match(first, /"first_plugin"/u);
  assert.match(first, /"godot_mcp_bridge"/u);
  assert.equal(first, second);
});
