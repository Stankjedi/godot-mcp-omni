import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

import {
  buildSpawnEnv,
  drainChildStderr,
  formatError,
  resolveServerEntryPath,
  shutdownChildProcess,
  waitForServerReady,
} from '../cli/runner_utils.js';
import type { ToolResponse } from '../tools/types.js';
import { JsonRpcProcessClient } from '../utils/jsonrpc_process_client.js';

type RunDoctorReportCliOptions = {
  projectPath: string;
  reportRelativePath?: string;
  godotPath?: string;
};

type SeverityCounts = { error: number; warning: number; info: number };

function validateReportRelativePath(reportRelativePath: string):
  | {
      ok: true;
      value: string;
    }
  | { ok: false; message: string } {
  const raw = reportRelativePath.trim();
  if (!raw) {
    return { ok: false, message: 'doctor-report-path must not be empty' };
  }
  if (raw.startsWith('user://')) {
    return {
      ok: false,
      message:
        'doctor-report-path must be project-relative (user:// is not supported)',
    };
  }
  if (raw.startsWith('res://')) {
    return {
      ok: false,
      message:
        'doctor-report-path must be a filesystem path relative to the project root (res:// is not supported)',
    };
  }

  const normalizedSlashes = raw.replace(/\\/gu, '/');
  const normalized = path.posix.normalize(normalizedSlashes);

  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.posix.isAbsolute(normalized)
  ) {
    return {
      ok: false,
      message:
        'doctor-report-path must be project-relative and must not escape the project root',
    };
  }

  if (normalized.endsWith('/')) {
    return { ok: false, message: 'doctor-report-path must be a file path' };
  }

  return { ok: true, value: normalized };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asFiniteInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.floor(value);
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }
  return null;
}

function extractSeverityCounts(toolResp: ToolResponse): {
  counts: SeverityCounts;
  total: number;
} | null {
  const summary = toolResp.details?.summary;
  if (!isRecord(summary)) return null;
  const issueCountTotal = asFiniteInt(summary.issueCountTotal);
  const bySeverity = summary.issueCountBySeverity;
  if (!isRecord(bySeverity)) return null;

  const error = asFiniteInt(bySeverity.error);
  const warning = asFiniteInt(bySeverity.warning);
  const info = asFiniteInt(bySeverity.info);
  if (
    issueCountTotal === null ||
    error === null ||
    warning === null ||
    info === null
  ) {
    return null;
  }

  return { counts: { error, warning, info }, total: issueCountTotal };
}

export async function runDoctorReportCli(
  options: RunDoctorReportCliOptions,
): Promise<{
  exitCode: number;
  output: Record<string, unknown>;
}> {
  const resolvedProjectPath = path.resolve(process.cwd(), options.projectPath);

  const reportRelativePathInput =
    typeof options.reportRelativePath === 'string' &&
    options.reportRelativePath.trim()
      ? options.reportRelativePath.trim()
      : '.godot_mcp/reports/doctor_report.md';

  const reportPathValidation = validateReportRelativePath(
    reportRelativePathInput,
  );
  if (!reportPathValidation.ok) {
    return {
      exitCode: 1,
      output: {
        ok: false,
        error: {
          code: 'E_PATH_VALIDATION',
          message: reportPathValidation.message,
          details: { reportRelativePath: reportRelativePathInput },
        },
      },
    };
  }

  const serverEntry = resolveServerEntryPath(import.meta.url);
  const effectiveGodotPath = (options.godotPath ?? process.env.GODOT_PATH ?? '')
    .trim()
    .trim();

  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: buildSpawnEnv({ ciSafe: false, effectiveGodotPath }),
  });

  // Avoid backpressure if the child writes logs to stderr (we never forward them).
  drainChildStderr(child);

  const client = new JsonRpcProcessClient(child);

  let output: Record<string, unknown> = {
    ok: false,
    error: { code: 'E_DOCTOR_REPORT_CLI', message: 'Unknown failure' },
  };
  let exitCode = 1;

  try {
    await waitForServerReady(client);

    const toolResp = await client.callTool(
      'godot_workspace_manager',
      {
        action: 'doctor_report',
        projectPath: resolvedProjectPath,
        reportRelativePath: reportPathValidation.value,
      },
      240_000,
    );

    if (!toolResp.ok) {
      output = {
        ok: false,
        toolOk: false,
        summary: toolResp.summary,
        error: toolResp.error ?? null,
        details: toolResp.details ?? null,
      };
      exitCode = 1;
      return { exitCode, output };
    }

    const reportPath =
      typeof toolResp.details?.reportPath === 'string'
        ? toolResp.details.reportPath
        : null;

    const parsedCounts = extractSeverityCounts(toolResp);
    const issueCountBySeverity = parsedCounts?.counts ?? null;
    const issueCountTotal = parsedCounts?.total ?? null;

    const hasErrors =
      typeof issueCountBySeverity?.error === 'number'
        ? issueCountBySeverity.error > 0
        : null;

    const ok = reportPath !== null && hasErrors === false;

    output = {
      ok,
      toolOk: true,
      projectPath: resolvedProjectPath,
      reportPath,
      issueCountBySeverity,
      issueCountTotal,
      toolSummary: toolResp.summary,
    };

    exitCode = ok ? 0 : 1;
    return { exitCode, output };
  } catch (error) {
    output = {
      ok: false,
      error: {
        code: 'E_DOCTOR_REPORT_CLI',
        message: formatError(error),
      },
    };
    exitCode = 1;
    return { exitCode, output };
  } finally {
    client.dispose();
    await shutdownChildProcess(child);
  }
}
