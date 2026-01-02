import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { discoverBundledGodotExecutables } from '../../build/godot_cli.js';

async function makeFakeBundledGodotWinExe(rootDir) {
  const bundleRoot = path.join(rootDir, 'Godot_v4.5.1-stable_mono_win64');
  const nested = path.join(bundleRoot, 'Godot_v4.5.1-stable_mono_win64');
  await mkdir(nested, { recursive: true });

  const exePath = path.join(
    nested,
    'Godot_v4.5.1-stable_mono_win64_console.exe',
  );
  await writeFile(exePath, 'dummy', 'utf8');
  return { bundleRoot, exePath };
}

test('discoverBundledGodotExecutables finds bundled Godot under cwd and parent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bundled-godot-'));
  try {
    const { exePath } = await makeFakeBundledGodotWinExe(dir);

    const nestedCwd = path.join(dir, 'godot-mcp-omni');
    await mkdir(nestedCwd, { recursive: true });

    const fromCwd = discoverBundledGodotExecutables('win32', dir);
    assert.ok(
      fromCwd.some((r) => r.origin === 'auto:bundle:cwd' && r.path === exePath),
    );

    const fromParent = discoverBundledGodotExecutables('win32', nestedCwd);
    assert.ok(
      fromParent.some(
        (r) => r.origin === 'auto:bundle:parent' && r.path === exePath,
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('discoverBundledGodotExecutables on linux only returns Windows .exe under WSL', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bundled-godot-linux-'));
  try {
    const { exePath } = await makeFakeBundledGodotWinExe(dir);

    const fromLinuxNoWsl = discoverBundledGodotExecutables('linux', dir, {
      isWsl: false,
    });
    assert.ok(!fromLinuxNoWsl.some((r) => r.path === exePath));

    const fromLinuxWsl = discoverBundledGodotExecutables('linux', dir, {
      isWsl: true,
    });
    assert.ok(fromLinuxWsl.some((r) => r.path === exePath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('discoverBundledGodotExecutables returns [] when no bundle dirs exist', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bundled-godot-empty-'));
  try {
    assert.deepEqual(discoverBundledGodotExecutables('win32', dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
