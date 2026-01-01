import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { formatError, spawnMcpServer, wait } from './mcp_test_harness.js';
import { mkdtemp, writeMinimalProject } from '../test/helpers.mjs';
import { deepSubstitute, isRecord } from '../build/utils/object_shape.js';

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
const REPORT_MD_PATH = path.join(
  __dirname,
  '..',
  '..',
  'devplan',
  'scenario_run_report.md',
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
  const args = argv.slice(2);
  let ciSafe = false;
  let noReport = false;
  let outDir = undefined;
  let reportPath = undefined;
  let mdReportPath = undefined;
  let help = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      help = true;
      continue;
    }
    if (a === '--ci-safe') {
      ciSafe = true;
      continue;
    }
    if (a === '--no-report') {
      noReport = true;
      continue;
    }
    if (a === '--out-dir') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --out-dir');
      }
      outDir = value;
      i += 1;
      continue;
    }
    if (a === '--report') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --report');
      }
      reportPath = value;
      i += 1;
      continue;
    }
    if (a === '--md-report') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --md-report');
      }
      mdReportPath = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${a}`);
  }

  return {
    ciSafe,
    noReport,
    outDir,
    reportPath,
    mdReportPath,
    help,
  };
}

function usage() {
  return [
    'Usage:',
    '  node scripts/run_mcp_scenarios.js [options]',
    '',
    'Options:',
    '  --ci-safe                 Force GODOT_PATH="" for the child MCP server',
    '  --no-report               Run scenarios but do not write report files',
    '  --out-dir <dir>           Write scenario_run_report.json/md into <dir>',
    '  --report <path>           Write JSON report to <path> (overrides --out-dir)',
    '  --md-report <path>        Write Markdown report to <path> (overrides --out-dir)',
    '  --help, -h                Show this help and exit',
    '',
    'Notes:',
    '  - With no output flags, reports are written to devplan/scenario_run_report.json and devplan/scenario_run_report.md.',
  ].join('\n');
}

function resolveOutputPaths(parsed) {
  if (parsed.noReport) return null;

  const hasAnyOutputHint =
    Boolean(parsed.outDir) ||
    Boolean(parsed.reportPath) ||
    Boolean(parsed.mdReportPath);

  if (!hasAnyOutputHint)
    return { jsonPath: REPORT_PATH, mdPath: REPORT_MD_PATH };

  const resolvedOutDir = parsed.outDir
    ? path.resolve(process.cwd(), parsed.outDir)
    : null;
  const resolvedReportPath = parsed.reportPath
    ? path.resolve(process.cwd(), parsed.reportPath)
    : null;
  const resolvedMdReportPath = parsed.mdReportPath
    ? path.resolve(process.cwd(), parsed.mdReportPath)
    : null;

  const baseDir =
    resolvedOutDir ??
    (resolvedReportPath ? path.dirname(resolvedReportPath) : null) ??
    (resolvedMdReportPath ? path.dirname(resolvedMdReportPath) : null) ??
    path.dirname(REPORT_PATH);

  return {
    jsonPath:
      resolvedReportPath ?? path.join(baseDir, 'scenario_run_report.json'),
    mdPath:
      resolvedMdReportPath ?? path.join(baseDir, 'scenario_run_report.md'),
  };
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

function escapeMarkdownCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br/>');
}

function formatScenarioStatus(status) {
  if (status === 'pass') return '✅ pass';
  if (status === 'skipped') return '⏭ skipped';
  return '❌ fail';
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push('# MCP 시나리오 실행 보고서');
  lines.push('');
  lines.push(
    '- 본 문서는 `devplan/scenario_run_report.json`을 사람이 읽기 쉬운 형태로 요약한 Markdown 버전입니다.',
  );
  lines.push(`- schemaVersion: ${escapeMarkdownCell(report.schemaVersion)}`);
  lines.push(`- 생성 시각: ${escapeMarkdownCell(report.generatedAt)}`);
  lines.push(`- CI-safe 모드: ${report.ciSafe ? 'true' : 'false'}`);
  const totals = report.totals ?? {};
  lines.push(
    `- GODOT_PATH 설정 여부: ${report.godotPathPresent ? 'true' : 'false'}`,
  );
  lines.push(`- totals: ${escapeMarkdownCell(JSON.stringify(totals))}`);
  lines.push(
    `- scenarios: ${escapeMarkdownCell((report.scenarios ?? []).length)}`,
  );
  lines.push('');

  lines.push('## 요약');
  lines.push('');
  lines.push('| total | ran | passed | failed | skipped |');
  lines.push('|:---:|:---:|:---:|:---:|:---:|');
  lines.push(
    `| ${totals.total ?? ''} | ${totals.ran ?? ''} | ${totals.passed ?? ''} | ${totals.failed ?? ''} | ${totals.skipped ?? ''} |`,
  );
  lines.push('');

  lines.push('## 시나리오 결과');
  lines.push('');
  lines.push(
    '| ID | 제목 | Tool | 기대 ok | Godot 필요 | Editor 필요 | 상태 | 소요(ms) | 요약/사유 |',
  );
  lines.push('|:---:|---|---|:---:|:---:|:---:|:---:|---:|---|');
  for (const s of report.scenarios ?? []) {
    lines.push(
      `| ${escapeMarkdownCell(s.id)} | ${escapeMarkdownCell(s.title)} | ${escapeMarkdownCell(s.tool)} | ${s.expectOk ? 'true' : 'false'} | ${s.requiresGodot ? 'true' : 'false'} | ${s.requiresEditor ? 'true' : 'false'} | ${formatScenarioStatus(s.status)} | ${escapeMarkdownCell(s.durationMs)} | ${escapeMarkdownCell(s.summary ?? s.reason ?? '')} |`,
    );
  }
  lines.push('');

  if (report.tools?.count) {
    lines.push(`## 등록된 도구 목록 (${report.tools.count}개)`);
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>도구 이름 펼치기</summary>');
    lines.push('');
    lines.push('```text');
    for (const name of report.tools.names ?? []) {
      lines.push(String(name));
    }
    lines.push('```');
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  lines.push('## 재현 방법');
  lines.push('');
  lines.push('- (Godot 필요 시) `GODOT_PATH`를 설정한 뒤 다음을 실행합니다.');
  lines.push('');
  lines.push('```bash');
  lines.push('cd godot-mcp-omni');
  lines.push('node scripts/run_mcp_scenarios.js');
  lines.push('```');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function run() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${message}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  if (parsed.help) {
    console.log(usage());
    process.exitCode = 0;
    return;
  }

  const { ciSafe } = parsed;
  const outputPaths = resolveOutputPaths(parsed);

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

  if (outputPaths) {
    fs.mkdirSync(path.dirname(outputPaths.jsonPath), { recursive: true });
    fs.mkdirSync(path.dirname(outputPaths.mdPath), { recursive: true });

    fs.writeFileSync(
      outputPaths.jsonPath,
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(outputPaths.mdPath, renderMarkdownReport(report), 'utf8');
  }

  const requiredFailures = report.scenarios.filter(
    (s) => s.status === 'fail' && !s.skipped,
  );
  if (requiredFailures.length > 0) {
    process.exitCode = 1;
    if (outputPaths) {
      console.error(
        `Scenario run completed with failures. Report: ${outputPaths.jsonPath}`,
      );
    } else {
      console.error('Scenario run completed with failures.');
    }
  } else {
    process.exitCode = 0;
    if (outputPaths) {
      console.log(`Scenario run completed. Report: ${outputPaths.jsonPath}`);
    } else {
      console.log('Scenario run completed.');
    }
  }
}

await run();
