import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeGodotArgsForHostForPlatform,
  normalizeGodotPathForHostForPlatform,
} from '../../build/godot_cli.js';

test('normalizeGodotPathForHostForPlatform converts Windows drive paths on linux', () => {
  assert.equal(
    normalizeGodotPathForHostForPlatform('linux', 'C:\\Godot\\Godot.exe'),
    '/mnt/c/Godot/Godot.exe',
  );
});

test('normalizeGodotPathForHostForPlatform leaves Windows paths unchanged on win32', () => {
  assert.equal(
    normalizeGodotPathForHostForPlatform('win32', 'C:\\Godot\\Godot.exe'),
    'C:\\Godot\\Godot.exe',
  );
});

test('normalizeGodotPathForHostForPlatform leaves "godot" unchanged', () => {
  assert.equal(normalizeGodotPathForHostForPlatform('linux', 'godot'), 'godot');
});

test('normalizeGodotArgsForHostForPlatform translates only --path/--script values for a Windows .exe on linux', () => {
  assert.deepEqual(
    normalizeGodotArgsForHostForPlatform('linux', 'C:\\Godot\\Godot.exe', [
      '--path',
      '/mnt/c/tmp/proj',
      '--script',
      '/mnt/d/scripts/test.gd',
      '--other',
      '/mnt/c/should-not-change',
    ]),
    [
      '--path',
      'C:\\tmp\\proj',
      '--script',
      'D:\\scripts\\test.gd',
      '--other',
      '/mnt/c/should-not-change',
    ],
  );
});

test('normalizeGodotArgsForHostForPlatform does not translate res:// or user://', () => {
  assert.deepEqual(
    normalizeGodotArgsForHostForPlatform('linux', 'C:\\Godot\\Godot.exe', [
      '--path',
      'res://scenes/Main.tscn',
      '--script',
      'user://scripts/test.gd',
      '--path',
      '/mnt/c/tmp/proj',
    ]),
    [
      '--path',
      'res://scenes/Main.tscn',
      '--script',
      'user://scripts/test.gd',
      '--path',
      'C:\\tmp\\proj',
    ],
  );
});

test('normalizeGodotArgsForHostForPlatform leaves args unchanged on linux when exe is not a Windows .exe', () => {
  const args = ['--path', '/mnt/c/tmp/proj'];
  assert.deepEqual(
    normalizeGodotArgsForHostForPlatform('linux', '/usr/bin/godot', args),
    args,
  );
});

test('normalizeGodotArgsForHostForPlatform leaves args unchanged on win32', () => {
  const args = ['--path', '/mnt/c/tmp/proj'];
  assert.deepEqual(
    normalizeGodotArgsForHostForPlatform('win32', 'C:\\Godot\\Godot.exe', args),
    args,
  );
});
