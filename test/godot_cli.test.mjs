import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { formatCommand, isValidGodotPathSync, quoteArg } from '../build/godot_cli.js';

test('quoteArg quotes args with spaces', () => {
  assert.equal(quoteArg('a b'), '"a b"');
});

test('quoteArg escapes double-quotes', () => {
  assert.equal(quoteArg('a"b'), '"a\\"b"');
});

test('formatCommand produces a stable command string', () => {
  assert.equal(formatCommand('godot', ['--headless', '--version']), 'godot --headless --version');
  assert.equal(
    formatCommand('C:\\Program Files\\Godot\\Godot.exe', ['--version']),
    '"C:\\Program Files\\Godot\\Godot.exe" --version'
  );
});

test('isValidGodotPathSync returns false for nonexistent paths', () => {
  const nonExistent = path.join(os.tmpdir(), `godot-mcp-omni-nope-${Date.now()}-${Math.random()}.exe`);
  assert.equal(isValidGodotPathSync(nonExistent), false);
});

