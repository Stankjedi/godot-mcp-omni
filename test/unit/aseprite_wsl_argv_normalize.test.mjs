import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAsepriteArgsForHost } from '../../build/pipeline/aseprite_runner.js';

test('normalizeAsepriteArgsForHost translates /mnt/<drive> paths when running a Windows .exe on linux', () => {
  assert.deepEqual(
    normalizeAsepriteArgsForHost('linux', 'C:\\Aseprite\\Aseprite.exe', [
      '--sheet',
      '/mnt/c/tmp/out.png',
      '/mnt/d/foo/bar.png',
    ]),
    ['--sheet', 'C:\\tmp\\out.png', 'D:\\foo\\bar.png'],
  );
});

test('normalizeAsepriteArgsForHost leaves args unchanged on linux when exe is not a Windows .exe', () => {
  const args = ['--sheet', '/mnt/c/tmp/out.png'];
  assert.deepEqual(
    normalizeAsepriteArgsForHost('linux', 'aseprite', args),
    args,
  );
});

test('normalizeAsepriteArgsForHost leaves args unchanged on win32', () => {
  const args = ['--sheet', '/mnt/c/tmp/out.png'];
  assert.deepEqual(
    normalizeAsepriteArgsForHost('win32', 'C:\\Aseprite\\Aseprite.exe', args),
    args,
  );
});
