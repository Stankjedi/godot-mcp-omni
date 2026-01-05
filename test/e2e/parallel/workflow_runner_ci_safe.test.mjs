import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('workflow runner executes a minimal workflow (CI-safe)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-mcp-omni-wf-'));
  const workflowPath = path.join(tmpDir, 'workflow.json');

  const workflow = {
    schemaVersion: 1,
    steps: [
      {
        id: 'WF-001',
        title: 'List tools',
        tool: 'tools/list',
        args: {},
        expectOk: true,
      },
    ],
  };

  fs.writeFileSync(
    workflowPath,
    `${JSON.stringify(workflow, null, 2)}\n`,
    'utf8',
  );

  try {
    const proc = spawnSync(
      process.execPath,
      ['build/index.js', '--run-workflow', workflowPath, '--ci-safe'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    assert.match(proc.stdout ?? '', /\nDONE\n/u);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
