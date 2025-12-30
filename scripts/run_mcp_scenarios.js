import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { formatError, spawnMcpServer, wait } from './mcp_test_harness.js';
import { mkdtemp, writeMinimalProject } from '../test/helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_ENTRY = path.join(__dirname, '..', 'build', 'index.js');
const REPORT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'devplan',
  'scenario_run_report.json',
);

const DEFAULT_SCENARIOS = [
  {
    id: 'SCN-001',
    title: 'macro_manager list_macros (CI-safe)',
    tool: 'macro_manager',
    args: { action: 'list_macros' },
    expectOk: true,
    requiresGodot: false,
    requiresEditor: false,
  },
  {
    id: 'SCN-002',
    title: 'godot_preflight minimal project (CI-safe)',
    tool: 'godot_preflight',
    args: { projectPath: '$PROJECT_PATH' },
    expectOk: true,
    requiresGodot: false,
    requiresEditor: false,
  },
  {
    id: 'SCN-003',
    title: 'pixel_goal_to_spec builtin (CI-safe)',
    tool: 'pixel_goal_to_spec',
    args: {
      projectPath: '$PROJECT_PATH',
      goal: 'tilemap + world (size 16x16), place trees density 0.2',
      allowExternalTools: false,
    },
    expectOk: true,
    requiresGodot: false,
    requiresEditor: false,
  },
  {
    id: 'SCN-004',
    title: 'pixel_manager goal_to_spec forwarding (CI-safe)',
    tool: 'pixel_manager',
    args: {
      action: 'goal_to_spec',
      projectPath: '$PROJECT_PATH',
      goal: 'tilemap + world (size 16x16)',
    },
    expectOk: true,
    requiresGodot: false,
    requiresEditor: false,
  },
  {
    id: 'SCN-005',
    title: 'godot_headless_batch write/read (Godot required)',
    tool: 'godot_headless_batch',
    args: {
      projectPath: '$PROJECT_PATH',
      steps: [
        {
          operation: 'write_text_file',
          params: { path: 'tmp/hello.txt', content: 'hello' },
        },
        { operation: 'read_text_file', params: { path: 'tmp/hello.txt' } },
      ],
    },
    expectOk: true,
    requiresGodot: true,
    requiresEditor: false,
  },
  {
    id: 'SCN-006',
    title: 'Editor tools are CI-safe when not connected',
    tool: 'godot_editor_batch',
    args: {},
    expectOk: false,
    requiresGodot: false,
    requiresEditor: false,
  },
];

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return {
    ciSafe: flags.has('--ci-safe'),
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepSubstitute(value, substitutions) {
  if (typeof value === 'string') {
    return substitutions[value] ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => deepSubstitute(entry, substitutions));
  }
  if (isRecord(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepSubstitute(v, substitutions);
    }
    return out;
  }
  return value;
}

function extractToolNames(toolsListResult) {
  if (!isRecord(toolsListResult) || !Array.isArray(toolsListResult.tools)) {
    return [];
  }
  return toolsListResult.tools
    .map((t) => (isRecord(t) ? t.name : undefined))
    .filter((name) => typeof name === 'string');
}

async function listTools(client) {
  const resp = await client.send('tools/list', {});
  if ('error' in resp) {
    throw new Error(`tools/list error: ${JSON.stringify(resp.error)}`);
  }
  return { raw: resp.result, toolNames: extractToolNames(resp.result) };
}

async function run() {
  const { ciSafe } = parseArgs(process.argv);

  if (!fs.existsSync(SERVER_ENTRY)) {
    console.error(
      `Missing MCP server entry: ${SERVER_ENTRY}\n` +
        `Run "cd godot-mcp-omni && npm run build" first.`,
    );
    process.exitCode = 2;
    return;
  }

  const effectiveGodotPath = ciSafe
    ? ''
    : (process.env.GODOT_PATH ?? '').trim();

  const projectPath = mkdtemp('godot-mcp-omni-scenarios-');
  writeMinimalProject(projectPath, 'ScenarioRunner');

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ciSafe,
    godotPathPresent: Boolean(effectiveGodotPath),
    totals: {
      total: DEFAULT_SCENARIOS.length,
      ran: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    },
    scenarios: [],
  };

  const { client, shutdown } = spawnMcpServer({
    serverEntry: SERVER_ENTRY,
    env: ciSafe ? { GODOT_PATH: '' } : {},
    allowDangerousOps: false,
  });

  let toolsInfo = { toolNames: [], raw: null };

  try {
    await wait(300);
    toolsInfo = await listTools(client);

    const substitutions = { $PROJECT_PATH: projectPath };

    for (const scenario of DEFAULT_SCENARIOS) {
      const startedAt = Date.now();
      const base = {
        ...scenario,
        status: 'fail',
        skipped: false,
        ok: false,
        reason: undefined,
        summary: undefined,
        durationMs: 0,
      };

      if (scenario.requiresGodot && !effectiveGodotPath) {
        const durationMs = Date.now() - startedAt;
        report.scenarios.push({
          ...base,
          status: 'skipped',
          skipped: true,
          ok: false,
          reason: 'GODOT_PATH not set',
          durationMs,
        });
        report.totals.skipped += 1;
        continue;
      }

      if (!toolsInfo.toolNames.includes(scenario.tool)) {
        const durationMs = Date.now() - startedAt;
        report.scenarios.push({
          ...base,
          status: 'fail',
          skipped: false,
          ok: false,
          reason: `Tool not registered: ${scenario.tool}`,
          durationMs,
        });
        report.totals.ran += 1;
        report.totals.failed += 1;
        continue;
      }

      const args = deepSubstitute(scenario.args, substitutions);
      try {
        const resp = await client.callTool(scenario.tool, args);
        const expected = Boolean(scenario.expectOk);
        const ok = resp.ok === expected;
        const durationMs = Date.now() - startedAt;
        report.scenarios.push({
          ...base,
          status: ok ? 'pass' : 'fail',
          ok,
          skipped: false,
          summary: resp.summary,
          reason: ok ? undefined : `Expected ok=${expected}, got ok=${resp.ok}`,
          durationMs,
        });
        report.totals.ran += 1;
        if (ok) report.totals.passed += 1;
        else report.totals.failed += 1;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        report.scenarios.push({
          ...base,
          status: 'fail',
          ok: false,
          skipped: false,
          reason: formatError(error),
          durationMs,
        });
        report.totals.ran += 1;
        report.totals.failed += 1;
      }
    }
  } finally {
    await shutdown();
    fs.rmSync(projectPath, { recursive: true, force: true });
  }

  report.tools = {
    count: toolsInfo.toolNames.length,
    names: toolsInfo.toolNames,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const requiredFailures = report.scenarios.filter(
    (s) => s.status === 'fail' && !s.skipped,
  );
  if (requiredFailures.length > 0) {
    process.exitCode = 1;
    console.error(
      `Scenario run completed with failures. Report: ${REPORT_PATH}`,
    );
  } else {
    process.exitCode = 0;
    console.log(`Scenario run completed. Report: ${REPORT_PATH}`);
  }
}

await run();
