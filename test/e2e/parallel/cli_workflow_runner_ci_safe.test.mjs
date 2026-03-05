import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { writeMinimalProject } from '../helpers.mjs';

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

test('CLI workflow runner supports JSON-only stdout output mode (CI-safe)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'godot-mcp-omni-wf-'));
  try {
    const workflowPath = path.join(tmp, 'workflow_json_stdout.json');
    const workflow = {
      schemaVersion: 1,
      steps: [
        {
          id: 'WF-JSON-001',
          title: 'tools/list',
          tool: 'tools/list',
          args: {},
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
      [
        buildIndexPath,
        '--run-workflow',
        workflowPath,
        '--ci-safe',
        '--workflow-json',
      ],
      { encoding: 'utf8' },
    );

    assert.equal(res.status, 0);
    assert.equal(res.stderr.trim(), '');

    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.failures, 0);
    assert.equal(parsed.stepsTotal, 1);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('CLI workflow runner forces ALLOW_EXTERNAL_TOOLS=false for the spawned server (CI-safe)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'godot-mcp-omni-wf-'));
  const priorAllowExternalTools = process.env.ALLOW_EXTERNAL_TOOLS;
  const priorSpecGenUrl = process.env.SPEC_GEN_URL;

  try {
    const projectPath = path.join(tmp, 'project');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(path.join(projectPath, 'scenes'), { recursive: true });
    writeMinimalProject(projectPath, 'ExternalToolsForcedOff');

    const workflowPath = path.join(tmp, 'workflow_external_tools.json');
    const workflow = {
      schemaVersion: 1,
      projectPath,
      steps: [
        {
          id: 'WF-EXT-001',
          title:
            'pixel_manager goal_to_spec ignores allowExternalTools in CI-safe',
          tool: 'pixel_manager',
          args: {
            projectPath: '$PROJECT_PATH',
            action: 'goal_to_spec',
            goal: 'Generate a small world tilemap 16x16 grass',
            allowExternalTools: true,
            timeoutMs: 50,
          },
        },
      ],
    };

    await fs.writeFile(
      workflowPath,
      `${JSON.stringify(workflow, null, 2)}\n`,
      'utf8',
    );

    process.env.ALLOW_EXTERNAL_TOOLS = 'true';
    process.env.SPEC_GEN_URL = 'http://127.0.0.1:1';

    const res = spawnSync(
      process.execPath,
      [buildIndexPath, '--run-workflow', workflowPath, '--ci-safe'],
      { encoding: 'utf8' },
    );

    assert.equal(res.status, 0);
    assert.equal(res.stderr.trim(), '');
  } finally {
    if (priorAllowExternalTools === undefined) {
      delete process.env.ALLOW_EXTERNAL_TOOLS;
    } else {
      process.env.ALLOW_EXTERNAL_TOOLS = priorAllowExternalTools;
    }

    if (priorSpecGenUrl === undefined) {
      delete process.env.SPEC_GEN_URL;
    } else {
      process.env.SPEC_GEN_URL = priorSpecGenUrl;
    }

    await fs.rm(tmp, { recursive: true, force: true });
  }
});
