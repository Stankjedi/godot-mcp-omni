#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createStepRunner,
  formatError,
  resolveGodotPath,
  spawnMcpServer,
  wait,
} from './mcp_test_harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  return [
    'Run an MCP workflow (a sequential list of tool calls) with strict step-by-step status.',
    '',
    'Usage:',
    '  node scripts/run_workflow.js --workflow <path> [--project <path>] [--godot-path <path>] [--ci-safe]',
    '',
    'Workflow file (JSON):',
    '  {',
    '    "schemaVersion": 1,',
    '    "projectPath": "/abs/or/relative/project",',
    '    "steps": [',
    '      { "id": "WF-001", "title": "tools/list", "tool": "tools/list", "args": {} },',
    '      { "id": "WF-002", "title": "Preflight", "tool": "godot_preflight", "args": { "projectPath": "$PROJECT_PATH" } }',
    '    ]',
    '  }',
    '',
    'Notes:',
    '  - Substitution: "$PROJECT_PATH" is replaced with --project (or workflow.projectPath).',
    '  - Default: ALLOW_DANGEROUS_OPS=false (safe mode).',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    workflowPath: null,
    projectPath: null,
    godotPath: null,
    ciSafe: false,
  };
  const rest = [...argv];

  while (rest.length > 0) {
    const token = rest.shift();
    if (!token) break;

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--workflow') {
      args.workflowPath = rest.shift() ?? null;
      continue;
    }
    if (token === '--project') {
      args.projectPath = rest.shift() ?? null;
      continue;
    }
    if (token === '--godot-path') {
      args.godotPath = rest.shift() ?? null;
      continue;
    }
    if (token === '--ci-safe') {
      args.ciSafe = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}\n\n${usage()}`);
  }

  return args;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepSubstitute(value, substitutions) {
  if (typeof value === 'string') return substitutions[value] ?? value;
  if (Array.isArray(value))
    return value.map((entry) => deepSubstitute(entry, substitutions));
  if (isRecord(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepSubstitute(v, substitutions);
    }
    return out;
  }
  return value;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(usage());
    process.exit(0);
    return;
  }

  if (!parsed.workflowPath) {
    console.error('Missing required flag: --workflow\n');
    console.error(usage());
    process.exit(2);
    return;
  }

  const repoRoot = path.resolve(__dirname, '..');
  const serverEntry = path.join(repoRoot, 'build', 'index.js');

  const workflowPath = path.resolve(process.cwd(), parsed.workflowPath);
  const raw = await fs.readFile(workflowPath, 'utf8');
  const workflow = JSON.parse(raw);
  if (!isRecord(workflow) || !Array.isArray(workflow.steps)) {
    throw new Error('Invalid workflow JSON: expected { steps: [...] }');
  }

  const projectPath =
    typeof parsed.projectPath === 'string' && parsed.projectPath.trim()
      ? parsed.projectPath.trim()
      : typeof workflow.projectPath === 'string' && workflow.projectPath.trim()
        ? workflow.projectPath.trim()
        : null;

  const substitutions = { $PROJECT_PATH: projectPath ?? '' };

  const effectiveGodotPath = parsed.ciSafe
    ? ''
    : await resolveGodotPath({
        godotPath: parsed.godotPath ?? undefined,
        strictPathValidation: false,
        exampleCommand:
          'GODOT_PATH="C:\\\\Path\\\\To\\\\Godot_v4.x_win64_console.exe" node scripts/run_workflow.js --workflow workflow.json --project ../my_project',
      });

  const { client, shutdown } = spawnMcpServer({
    serverEntry,
    env: {
      ...(parsed.ciSafe
        ? { GODOT_PATH: '' }
        : { GODOT_PATH: effectiveGodotPath }),
      ALLOW_DANGEROUS_OPS: 'false',
    },
    allowDangerousOps: false,
  });

  const { runStep, results } = createStepRunner();

  try {
    await wait(250);

    for (let index = 0; index < workflow.steps.length; index += 1) {
      const step = workflow.steps[index];
      if (!isRecord(step))
        throw new Error(`Invalid workflow step at index ${index}`);

      const id =
        typeof step.id === 'string' ? step.id.trim() : `STEP-${index + 1}`;
      const title =
        typeof step.title === 'string' && step.title.trim()
          ? step.title.trim()
          : typeof step.tool === 'string'
            ? step.tool
            : 'unknown';
      const tool = typeof step.tool === 'string' ? step.tool.trim() : '';
      const expectOk =
        typeof step.expectOk === 'boolean' ? step.expectOk : true;

      if (!tool) throw new Error(`Missing step.tool for ${id}`);

      const rawArgs = isRecord(step.args) ? step.args : {};
      const args = deepSubstitute(rawArgs, substitutions);

      await runStep(`[${id}] ${title}`, async () => {
        if (tool === 'tools/list') {
          const resp = await client.send('tools/list', {});
          if ('error' in resp) throw new Error(JSON.stringify(resp.error));
          if (expectOk !== true)
            throw new Error('tools/list does not support expectOk=false');
          return resp.result;
        }

        const resp = await client.callTool(tool, args);
        if (resp.ok !== expectOk) {
          throw new Error(
            `Expected ok=${expectOk}, got ok=${resp.ok} (${resp.summary ?? 'no summary'})`,
          );
        }
        if (!resp.ok) throw new Error(resp.summary ?? 'Tool failed');
        return resp;
      });
    }
  } finally {
    await shutdown();
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) process.exit(1);

  console.log('');
  console.log('DONE');
  console.log(`Workflow: ${workflowPath}`);
  if (projectPath) console.log(`Project: ${projectPath}`);
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
