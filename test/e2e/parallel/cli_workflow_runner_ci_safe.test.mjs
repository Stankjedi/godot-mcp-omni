import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildIndexPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'build',
  'index.js',
);

test('CLI workflow runner executes a minimal workflow (CI-safe) and exits 0', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'godot-mcp-omni-wf-'));
  try {
    const workflowPath = path.join(tmp, 'workflow.json');
    const workflow = {
      schemaVersion: 1,
      steps: [
        { id: 'WF-001', title: 'tools/list', tool: 'tools/list', args: {} },
        {
          id: 'WF-002',
          title: 'workflow_manager macro.list',
          tool: 'workflow_manager',
          args: { action: 'macro.list' },
        },
      ],
    };

    await fs.writeFile(
      workflowPath,
      `${JSON.stringify(workflow, null, 2)}\n`,
      'utf8',
    );

    const res = spawnSync(
      process.execPath,
      [buildIndexPath, '--run-workflow', workflowPath, '--ci-safe'],
      { encoding: 'utf8' },
    );

    assert.equal(res.status, 0);
    assert.match(res.stdout, /DONE/u);
    assert.equal(res.stderr.trim(), '');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
