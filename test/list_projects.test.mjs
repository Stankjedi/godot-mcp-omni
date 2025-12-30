import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProjectToolHandlers } from '../build/tools/project.js';

const ctx = {
  ensureNoTraversal: () => {},
  logDebug: () => {},
};

function getProjectPaths(result) {
  assert.equal(result.ok, true);
  assert.ok(result.details && typeof result.details === 'object');
  assert.ok(Array.isArray(result.details.projects));
  return result.details.projects.map((p) => p.path);
}

test('list_projects skips node_modules by default when recursive=true', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'godot-mcp-omni-list-'));
  try {
    const projectA = path.join(base, 'ProjectA');
    await fs.mkdir(projectA, { recursive: true });
    await fs.writeFile(
      path.join(projectA, 'project.godot'),
      'config_version=5\n',
    );

    const hiddenProject = path.join(base, 'node_modules', 'HiddenProject');
    await fs.mkdir(hiddenProject, { recursive: true });
    await fs.writeFile(
      path.join(hiddenProject, 'project.godot'),
      'config_version=5\n',
    );

    const handlers = createProjectToolHandlers(ctx);
    const res = await handlers.list_projects({
      directory: base,
      recursive: true,
    });
    const paths = getProjectPaths(res);

    assert.ok(paths.includes(projectA));
    assert.ok(!paths.includes(hiddenProject));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('list_projects can override ignoreDirs to include node_modules', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'godot-mcp-omni-list-'));
  try {
    const projectA = path.join(base, 'ProjectA');
    await fs.mkdir(projectA, { recursive: true });
    await fs.writeFile(
      path.join(projectA, 'project.godot'),
      'config_version=5\n',
    );

    const hiddenProject = path.join(base, 'node_modules', 'HiddenProject');
    await fs.mkdir(hiddenProject, { recursive: true });
    await fs.writeFile(
      path.join(hiddenProject, 'project.godot'),
      'config_version=5\n',
    );

    const handlers = createProjectToolHandlers(ctx);
    const res = await handlers.list_projects({
      directory: base,
      recursive: true,
      ignoreDirs: [],
    });
    const paths = getProjectPaths(res);

    assert.ok(paths.includes(projectA));
    assert.ok(paths.includes(hiddenProject));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
