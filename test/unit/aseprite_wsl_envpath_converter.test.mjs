import assert from 'node:assert/strict';
import test from 'node:test';

import { windowsDrivePathToWslPath } from '../../build/pipeline/aseprite_runner.js';

test('windowsDrivePathToWslPath converts Windows drive paths to /mnt/<drive>', () => {
  assert.equal(
    windowsDrivePathToWslPath('C:\\Program Files\\Aseprite\\Aseprite.exe'),
    '/mnt/c/Program Files/Aseprite/Aseprite.exe',
  );
  assert.equal(
    windowsDrivePathToWslPath('D:/Games/Aseprite/Aseprite.exe'),
    '/mnt/d/Games/Aseprite/Aseprite.exe',
  );
});

test('windowsDrivePathToWslPath leaves non-Windows drive paths unchanged', () => {
  assert.equal(windowsDrivePathToWslPath('/mnt/c/foo/bar'), '/mnt/c/foo/bar');
  assert.equal(windowsDrivePathToWslPath('aseprite'), 'aseprite');
});
