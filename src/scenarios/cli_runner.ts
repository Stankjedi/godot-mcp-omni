import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { JsonRpcProcessClient } from '../utils/jsonrpc_process_client.js';
import { deepSubstitute, isRecord } from '../utils/object_shape.js';
import { DEFAULT_CI_SAFE_SCENARIOS } from './default_scenarios.js';

type ScenarioReportOutputOptions = {
  noReport: boolean;
  outDir?: string;
  reportPath?: string;
  mdReportPath?: string;
};

type RunScenariosCliOptions = {
  ciSafe: boolean;
  godotPath?: string;
  report: ScenarioReportOutputOptions;
};

type ScenarioReportStatus = 'pass' | 'fail' | 'skipped';

type ScenarioRunReportScenario = {
  id: string;
  title: string;
  tool: string;
  expectOk: boolean;
  status: ScenarioReportStatus;
  durationMs: number;
  summary?: string;
  reason?: string;
};

type ScenarioRunReport = {
  schemaVersion: number;
  generatedAt: string;
  ciSafe: boolean;
  godotPathPresent: boolean;
  totals: {
    total: number;
    ran: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  scenarios: ScenarioRunReportScenario[];
  tools: { count: number; names: string[] };
};

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveServerEntryPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', 'index.js');
}

function resolveDefaultReportPaths(): { jsonPath: string; mdPath: string } {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  return {
    jsonPath: path.join(repoRoot, 'devplan', 'scenario_run_report.json'),
    mdPath: path.join(repoRoot, 'devplan', 'scenario_run_report.md'),
  };
}

function resolveOutputPaths(
  options: ScenarioReportOutputOptions,
): { jsonPath: string; mdPath: string } | null {
  if (options.noReport) return null;

  const hasAnyOutputHint =
    Boolean(options.outDir) ||
    Boolean(options.reportPath) ||
    Boolean(options.mdReportPath);

  const defaults = resolveDefaultReportPaths();
  if (!hasAnyOutputHint) return defaults;

  const resolvedOutDir = options.outDir
    ? path.resolve(process.cwd(), options.outDir)
    : null;
  const resolvedReportPath = options.reportPath
    ? path.resolve(process.cwd(), options.reportPath)
    : null;
  const resolvedMdReportPath = options.mdReportPath
    ? path.resolve(process.cwd(), options.mdReportPath)
    : null;

  const baseDir =
    resolvedOutDir ??
    (resolvedReportPath ? path.dirname(resolvedReportPath) : null) ??
    (resolvedMdReportPath ? path.dirname(resolvedMdReportPath) : null) ??
    path.dirname(defaults.jsonPath);

  return {
    jsonPath:
      resolvedReportPath ?? path.join(baseDir, 'scenario_run_report.json'),
    mdPath:
      resolvedMdReportPath ?? path.join(baseDir, 'scenario_run_report.md'),
  };
}

function extractToolNames(toolsListResult: unknown): string[] {
  if (!isRecord(toolsListResult) || !Array.isArray(toolsListResult.tools)) {
    return [];
  }
  return toolsListResult.tools
    .map((t) => (isRecord(t) ? t.name : undefined))
    .filter((name) => typeof name === 'string');
}

function escapeMarkdownCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br/>');
}

function formatScenarioStatus(status: ScenarioReportStatus): string {
  if (status === 'pass') return '✅ pass';
  if (status === 'skipped') return '⏭ skipped';
  return '❌ fail';
}

function renderMarkdownReport(report: ScenarioRunReport): string {
  const lines: string[] = [];
  lines.push('# MCP 시나리오 실행 보고서');
  lines.push('');
  lines.push(
    '- 본 문서는 `scenario_run_report.json`을 사람이 읽기 쉬운 형태로 요약한 Markdown 버전입니다.',
  );
  lines.push(`- schemaVersion: ${escapeMarkdownCell(report.schemaVersion)}`);
  lines.push(`- 생성 시각: ${escapeMarkdownCell(report.generatedAt)}`);
  lines.push(`- CI-safe 모드: ${report.ciSafe ? 'true' : 'false'}`);
  lines.push(
    `- GODOT_PATH 설정 여부: ${report.godotPathPresent ? 'true' : 'false'}`,
  );
  lines.push(`- totals: ${escapeMarkdownCell(JSON.stringify(report.totals))}`);
  lines.push(
    `- scenarios: ${escapeMarkdownCell((report.scenarios ?? []).length)}`,
  );
  lines.push('');

  lines.push('## 요약');
  lines.push('');
  lines.push('| total | ran | passed | failed | skipped |');
  lines.push('|:---:|:---:|:---:|:---:|:---:|');
  lines.push(
    `| ${report.totals.total} | ${report.totals.ran} | ${report.totals.passed} | ${report.totals.failed} | ${report.totals.skipped} |`,
  );
  lines.push('');

  lines.push('## 시나리오 결과');
  lines.push('');
  lines.push('| ID | 제목 | Tool | 기대 ok | 상태 | 소요(ms) | 요약/사유 |');
  lines.push('|:---:|---|---|:---:|:---:|---:|---|');
  for (const s of report.scenarios ?? []) {
    lines.push(
      `| ${escapeMarkdownCell(s.id)} | ${escapeMarkdownCell(s.title)} | ${escapeMarkdownCell(s.tool)} | ${s.expectOk ? 'true' : 'false'} | ${formatScenarioStatus(s.status)} | ${escapeMarkdownCell(s.durationMs)} | ${escapeMarkdownCell(s.summary ?? s.reason ?? '')} |`,
    );
  }
  lines.push('');

  if (report.tools.count > 0) {
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
  lines.push('node build/index.js --run-scenarios');
  lines.push('```');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function shutdownChildProcess(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  if (child.exitCode !== null) return;

  try {
    child.stdin?.end();
  } catch {
    // Ignore.
  }

  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });

  child.kill();
  await Promise.race([exitPromise, sleep(2000)]);

  if (child.exitCode !== null) return;
  if (process.platform !== 'win32') {
    child.kill('SIGKILL');
    await Promise.race([exitPromise, sleep(2000)]);
  }
}

async function writeMinimalProject(projectPath: string): Promise<void> {
  await fs.mkdir(path.join(projectPath, 'scenes'), { recursive: true });

  const lines: string[] = [
    '; Engine configuration file.',
    "; It's best edited using the editor, not directly.",
    'config_version=5',
    '',
    '[application]',
    'config/name="godot-mcp-omni-ci-safe-scenarios"',
    '',
  ];

  await fs.writeFile(
    path.join(projectPath, 'project.godot'),
    lines.join('\n'),
    'utf8',
  );
}

export async function runScenariosCli(
  options: RunScenariosCliOptions,
): Promise<{ ok: boolean; failures: number }> {
  const serverEntry = resolveServerEntryPath();
  const scenarios = DEFAULT_CI_SAFE_SCENARIOS;
  const outputPaths = resolveOutputPaths(options.report);

  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'godot-mcp-omni-cli-scenarios-'),
  );
  const projectPath = path.join(tmpRoot, 'project');
  await writeMinimalProject(projectPath);

  const substitutions = { $PROJECT_PATH: projectPath };
  const effectiveGodotPath = options.ciSafe
    ? ''
    : (options.godotPath ?? process.env.GODOT_PATH ?? '').trim();

  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      ...(options.ciSafe
        ? { GODOT_PATH: '' }
        : { GODOT_PATH: effectiveGodotPath }),
      ALLOW_DANGEROUS_OPS: 'false',
    },
  });

  let failures = 0;
  const client = new JsonRpcProcessClient(child);

  const report: ScenarioRunReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ciSafe: options.ciSafe,
    godotPathPresent: Boolean(effectiveGodotPath),
    totals: {
      total: scenarios.length,
      ran: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    },
    scenarios: [],
    tools: { count: 0, names: [] },
  };

  let toolsListError: string | null = null;
  let toolsListDurationMs = 0;
  let toolNames: string[] = [];

  try {
    await sleep(250);

    {
      const startedAt = Date.now();
      try {
        const resp = await client.send('tools/list', {});
        toolsListDurationMs = Date.now() - startedAt;
        if ('error' in resp) {
          throw new Error(`tools/list error: ${JSON.stringify(resp.error)}`);
        }
        toolNames = extractToolNames(resp.result);
      } catch (error) {
        toolsListDurationMs = Date.now() - startedAt;
        toolsListError = formatError(error);
        toolNames = [];
      }
      report.tools = { count: toolNames.length, names: toolNames };
    }

    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      const label = `[${index + 1}/${scenarios.length} ${scenario.id}] ${scenario.title}`;
      const startedAt = Date.now();

      try {
        if (scenario.tool === 'tools/list') {
          if (scenario.expectOk !== true) {
            throw new Error('tools/list does not support expectOk=false');
          }

          if (toolsListError) {
            failures += 1;
            report.totals.ran += 1;
            report.totals.failed += 1;
            report.scenarios.push({
              id: scenario.id,
              title: scenario.title,
              tool: scenario.tool,
              expectOk: scenario.expectOk,
              status: 'fail',
              durationMs: toolsListDurationMs,
              reason: toolsListError,
            });
            console.error(`${label}: FAIL - ${toolsListError}`);
            continue;
          }

          report.totals.ran += 1;
          report.totals.passed += 1;
          report.scenarios.push({
            id: scenario.id,
            title: scenario.title,
            tool: scenario.tool,
            expectOk: scenario.expectOk,
            status: 'pass',
            durationMs: toolsListDurationMs,
          });
          console.log(`${label}: ok`);
          continue;
        }

        const substitutedArgs = deepSubstitute(scenario.args, substitutions);
        if (!isRecord(substitutedArgs)) {
          throw new Error(
            'Invalid scenario args after substitution: expected an object',
          );
        }

        const resp = await client.callTool(scenario.tool, substitutedArgs);
        if (resp.ok !== scenario.expectOk) {
          throw new Error(
            `Expected ok=${scenario.expectOk}, got ok=${resp.ok} (${resp.summary ?? 'no summary'})`,
          );
        }

        const durationMs = Date.now() - startedAt;
        report.totals.ran += 1;
        report.totals.passed += 1;
        report.scenarios.push({
          id: scenario.id,
          title: scenario.title,
          tool: scenario.tool,
          expectOk: scenario.expectOk,
          status: 'pass',
          durationMs,
          summary: resp.summary,
        });
        console.log(`${label}: ok (${resp.summary ?? 'no summary'})`);
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        failures += 1;
        console.error(`${label}: FAIL - ${formatError(error)}`);
        report.totals.ran += 1;
        report.totals.failed += 1;
        report.scenarios.push({
          id: scenario.id,
          title: scenario.title,
          tool: scenario.tool,
          expectOk: scenario.expectOk,
          status: 'fail',
          durationMs,
          reason: formatError(error),
        });
      }
    }
  } finally {
    client.dispose();
    await shutdownChildProcess(child);
    if (outputPaths) {
      await fs.mkdir(path.dirname(outputPaths.jsonPath), { recursive: true });
      await fs.mkdir(path.dirname(outputPaths.mdPath), { recursive: true });

      await fs.writeFile(
        outputPaths.jsonPath,
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
      );
      await fs.writeFile(
        outputPaths.mdPath,
        renderMarkdownReport(report),
        'utf8',
      );
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }

  console.log('');
  if (failures === 0) {
    console.log('SCENARIOS: OK');
  } else {
    console.log(`SCENARIOS: FAIL (${failures} failures)`);
  }

  return { ok: failures === 0, failures };
}
