import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldTranslateWslPathsForWindowsExe,
  windowsDrivePathToWslPath,
  wslPathToWindowsDrivePath,
} from '../../build/platform/path_translation.js';

test('windowsDrivePathToWslPath converts Windows drive paths', () => {
  assert.equal(
    windowsDrivePathToWslPath('C:\\Program Files\\Aseprite\\Aseprite.exe'),
    '/mnt/c/Program Files/Aseprite/Aseprite.exe',
  );
  assert.equal(
    windowsDrivePathToWslPath('D:/Games/Aseprite/Aseprite.exe'),
    '/mnt/d/Games/Aseprite/Aseprite.exe',
  );
});

test('windowsDrivePathToWslPath returns null for non-drive paths', () => {
  assert.equal(windowsDrivePathToWslPath('/mnt/c/foo/bar'), null);
  assert.equal(windowsDrivePathToWslPath('aseprite'), null);
});

test('wslPathToWindowsDrivePath converts /mnt/<drive> paths', () => {
  assert.equal(
    wslPathToWindowsDrivePath('/mnt/c/tmp/out.png'),
    'C:\\tmp\\out.png',
  );
  assert.equal(
    wslPathToWindowsDrivePath('/mnt/d/foo/bar.png'),
    'D:\\foo\\bar.png',
  );
});

test('wslPathToWindowsDrivePath returns null for non-/mnt paths', () => {
  assert.equal(wslPathToWindowsDrivePath('C:\\tmp\\out.png'), null);
  assert.equal(wslPathToWindowsDrivePath('res://foo'), null);
});

test('shouldTranslateWslPathsForWindowsExe indicates when to translate WSL paths for a Windows .exe', () => {
  assert.equal(
    shouldTranslateWslPathsForWindowsExe('linux', 'C:\\Godot\\Godot.exe'),
    true,
  );
  assert.equal(
    shouldTranslateWslPathsForWindowsExe('linux', '/usr/bin/godot'),
    false,
  );
  assert.equal(
    shouldTranslateWslPathsForWindowsExe('win32', 'C:\\Godot\\Godot.exe'),
    false,
  );
});
