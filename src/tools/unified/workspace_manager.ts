import path from 'path';
import fs from 'fs/promises';

import {
  assertEditorRpcAllowed,
  resolveInsideProject,
} from '../../security.js';
import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNumber,
  asOptionalRecord,
  asOptionalString,
  asRecord,
} from '../../validation.js';

import type { ServerContext } from '../context.js';
import type { ToolHandler, ToolResponse } from '../types.js';

import { buildDoctorReport, withDoctorDefaults } from '../../doctor/report.js';
import { getTopIssues, normalizeIssues } from '../../doctor/normalize.js';
import type {
  DoctorIssue,
  DoctorScanMeta,
  DoctorScanOptions,
} from '../../doctor/types.js';
import { renderDoctorReportMarkdown } from '../../doctor/markdown.js';

import {
  type BaseToolHandlers,
  callBaseTool,
  hasEditorConnection,
  maybeGetString,
  normalizeAction,
  requireEditorConnected,
  supportedActionError,
} from './shared.js';

export function createWorkspaceManagerHandler(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): ToolHandler {
  return async (args: unknown): Promise<ToolResponse> => {
    const argsObj = asRecord(args, 'args');
    const actionRaw = asNonEmptyString(argsObj.action, 'action');
    const action = normalizeAction(actionRaw);

    const supportedActions = [
      'launch',
      'connect',
      'status',
      'run',
      'stop',
      'open_scene',
      'save_all',
      'restart',
      'doctor_report',
    ];

    const resolveDoctorReportPath = (
      projectPath: string,
      reportRelativePath: string,
    ): { absPath: string; policy: 'project' | 'dangerous_external' } => {
      const rel = reportRelativePath.trim();
      if (rel.startsWith('user://')) {
        throw new Error(
          `Disallowed reportRelativePath scheme (user://): ${rel}`,
        );
      }

      const dangerous = process.env.ALLOW_DANGEROUS_OPS === 'true';

      if (path.isAbsolute(rel)) {
        const abs = path.resolve(rel);
        try {
          const inside = resolveInsideProject(projectPath, abs);
          return { absPath: inside, policy: 'project' };
        } catch {
          if (!dangerous) {
            throw new Error(
              'reportRelativePath must be inside the project root (set ALLOW_DANGEROUS_OPS=true to allow external report paths).',
            );
          }
          return { absPath: abs, policy: 'dangerous_external' };
        }
      }

      try {
        return {
          absPath: resolveInsideProject(projectPath, rel),
          policy: 'project',
        };
      } catch (error) {
        if (!dangerous) throw error;
        return {
          absPath: path.resolve(projectPath, rel),
          policy: 'dangerous_external',
        };
      }
    };

    if (action === 'launch') {
      return await callBaseTool(baseHandlers, 'launch_editor', {
        ...argsObj,
      });
    }

    if (action === 'connect') {
      return await callBaseTool(baseHandlers, 'godot_connect_editor', {
        ...argsObj,
      });
    }

    if (action === 'status') {
      const connected = hasEditorConnection(ctx);
      const editorProjectPath = ctx.getEditorProjectPath();

      const godotPathRaw =
        maybeGetString(argsObj, ['godotPath', 'godot_path'], 'godotPath') ??
        process.env.GODOT_PATH;
      const godotPath =
        typeof godotPathRaw === 'string' && godotPathRaw.trim().length > 0
          ? godotPathRaw.trim()
          : null;

      const suggestions: string[] = [];

      if (!connected) {
        suggestions.push('Call godot_workspace_manager(action="connect").');
        suggestions.push(
          'If the editor is not running, call godot_workspace_manager(action="launch") first.',
        );
      } else {
        suggestions.push(
          'Editor bridge connected; you can use open_scene/save_all and other editor actions.',
        );
      }

      if (!godotPath) {
        suggestions.push(
          'Set GODOT_PATH (or pass godotPath) for headless actions like run/doctor_report.',
        );
      }

      return {
        ok: true,
        summary: 'Workspace status',
        details: {
          connected,
          editorProjectPath: editorProjectPath ?? null,
          godotPath,
          suggestions,
        },
      };
    }

    if (action === 'open_scene') {
      if (!hasEditorConnection(ctx))
        return requireEditorConnected('open_scene');
      const scenePath = maybeGetString(
        argsObj,
        ['scenePath', 'scene_path', 'path'],
        'scenePath',
      );
      if (!scenePath) {
        return {
          ok: false,
          summary: 'open_scene requires scenePath',
          details: { required: ['scenePath'] },
        };
      }
      const rpcParams: Record<string, unknown> = { path: scenePath };
      assertEditorRpcAllowed(
        'open_scene',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      return await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'open_scene', params: rpcParams },
      });
    }

    if (action === 'save_all') {
      if (!hasEditorConnection(ctx)) return requireEditorConnected('save_all');
      assertEditorRpcAllowed(
        'editor.save_all',
        {},
        ctx.getEditorProjectPath() ?? '',
      );
      return await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'editor.save_all', params: {} },
      });
    }

    if (action === 'run') {
      const mode =
        maybeGetString(argsObj, ['mode', 'runMode'], 'mode') ?? 'auto';
      const wantsHeadless = mode.trim().toLowerCase() === 'headless';
      if (hasEditorConnection(ctx) && !wantsHeadless) {
        assertEditorRpcAllowed(
          'editor.play_main',
          {},
          ctx.getEditorProjectPath() ?? '',
        );
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'editor.play_main', params: {} },
        });
      }
      return await callBaseTool(baseHandlers, 'run_project', {
        ...argsObj,
        ...(wantsHeadless ? { headless: true } : {}),
      });
    }

    if (action === 'stop') {
      const mode =
        maybeGetString(argsObj, ['mode', 'runMode'], 'mode') ?? 'auto';
      const wantsHeadless = mode.trim().toLowerCase() === 'headless';
      if (hasEditorConnection(ctx) && !wantsHeadless) {
        assertEditorRpcAllowed(
          'editor.stop',
          {},
          ctx.getEditorProjectPath() ?? '',
        );
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'editor.stop', params: {} },
        });
      }
      return await callBaseTool(baseHandlers, 'stop_project', { ...argsObj });
    }

    if (action === 'restart') {
      const mode =
        maybeGetString(argsObj, ['mode', 'runMode'], 'mode') ?? 'auto';
      const wantsHeadless = mode.trim().toLowerCase() === 'headless';
      if (hasEditorConnection(ctx) && !wantsHeadless) {
        assertEditorRpcAllowed(
          'editor.restart',
          {},
          ctx.getEditorProjectPath() ?? '',
        );
        const restartResp = await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'editor.restart', params: {} },
        });
        if (restartResp.ok) return restartResp;

        // Fallback: restart play session when editor restart is not supported.
        await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'editor.stop', params: {} },
        });
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'editor.play_main', params: {} },
        });
      }

      const projectPath = maybeGetString(
        argsObj,
        ['projectPath', 'project_path'],
        'projectPath',
      );
      if (!projectPath) {
        const active = ctx.getActiveProcess();
        if (active?.projectPath) {
          return await callBaseTool(baseHandlers, 'run_project', {
            projectPath: active.projectPath,
            ...(wantsHeadless ? { headless: true } : {}),
          });
        }
        return {
          ok: false,
          summary: 'restart requires projectPath when no active process exists',
          details: { required: ['projectPath'] },
        };
      }

      await callBaseTool(baseHandlers, 'stop_project', {});
      return await callBaseTool(baseHandlers, 'run_project', {
        ...argsObj,
        projectPath,
        ...(wantsHeadless ? { headless: true } : {}),
      });
    }

    if (action === 'doctor_report') {
      const projectPath = maybeGetString(
        argsObj,
        ['projectPath', 'project_path'],
        'projectPath',
      );
      if (!projectPath) {
        return {
          ok: false,
          summary: 'doctor_report requires projectPath',
          details: { required: ['projectPath'] },
        };
      }
      ctx.assertValidProject(projectPath);

      const reportRelativePath =
        asOptionalString(
          (argsObj as Record<string, unknown>).reportRelativePath ??
            (argsObj as Record<string, unknown>).report_relative_path,
          'reportRelativePath',
        )?.trim() ?? '.godot_mcp/reports/doctor_report.md';

      const mode =
        maybeGetString(argsObj, ['mode', 'runMode'], 'mode') ?? 'headless';
      void mode; // v1: treat all modes as headless-first.

      const optionsObj =
        asOptionalRecord(
          (argsObj as Record<string, unknown>).options,
          'options',
        ) ?? {};
      const options: DoctorScanOptions = {
        includeAssets:
          asOptionalBoolean(
            optionsObj.includeAssets,
            'options.includeAssets',
          ) ??
          asOptionalBoolean(
            (optionsObj as Record<string, unknown>).include_assets,
            'options.include_assets',
          ) ??
          true,
        includeScripts:
          asOptionalBoolean(
            optionsObj.includeScripts,
            'options.includeScripts',
          ) ??
          asOptionalBoolean(
            (optionsObj as Record<string, unknown>).include_scripts,
            'options.include_scripts',
          ) ??
          true,
        includeScenes:
          asOptionalBoolean(
            optionsObj.includeScenes,
            'options.includeScenes',
          ) ??
          asOptionalBoolean(
            (optionsObj as Record<string, unknown>).include_scenes,
            'options.include_scenes',
          ) ??
          true,
        includeUID:
          asOptionalBoolean(optionsObj.includeUID, 'options.includeUID') ??
          asOptionalBoolean(
            (optionsObj as Record<string, unknown>).include_uid,
            'options.include_uid',
          ) ??
          true,
        includeExport:
          asOptionalBoolean(
            optionsObj.includeExport,
            'options.includeExport',
          ) ??
          asOptionalBoolean(
            (optionsObj as Record<string, unknown>).include_export,
            'options.include_export',
          ) ??
          false,
        maxIssuesPerCategory: Math.floor(
          asOptionalNumber(
            optionsObj.maxIssuesPerCategory,
            'options.maxIssuesPerCategory',
          ) ??
            asOptionalNumber(
              (optionsObj as Record<string, unknown>).max_issues_per_category,
              'options.max_issues_per_category',
            ) ??
            200,
        ),
        timeBudgetMs: Math.floor(
          asOptionalNumber(optionsObj.timeBudgetMs, 'options.timeBudgetMs') ??
            asOptionalNumber(
              (optionsObj as Record<string, unknown>).time_budget_ms,
              'options.time_budget_ms',
            ) ??
            180_000,
        ),
        deepSceneInstantiate:
          asOptionalBoolean(
            optionsObj.deepSceneInstantiate,
            'options.deepSceneInstantiate',
          ) ??
          asOptionalBoolean(
            (optionsObj as Record<string, unknown>).deep_scene_instantiate,
            'options.deep_scene_instantiate',
          ) ??
          false,
      };

      const normalizedOptions = withDoctorDefaults(options);
      const issues: DoctorIssue[] = [];

      const versionResp = await callBaseTool(
        baseHandlers,
        'get_godot_version',
        {},
      );
      const godotVersion =
        versionResp.ok &&
        versionResp.details &&
        typeof versionResp.details === 'object' &&
        !Array.isArray(versionResp.details) &&
        typeof (versionResp.details as Record<string, unknown>).version ===
          'string'
          ? String(
              (versionResp.details as Record<string, unknown>).version,
            ).trim()
          : null;

      if (!godotVersion) {
        issues.push({
          issueId: 'GODOT_VERSION_UNAVAILABLE',
          severity: 'error',
          category: 'environment',
          title: 'Failed to detect Godot version',
          message: versionResp.summary ?? 'Failed to detect Godot version',
          relatedMcpActions: ['godot_preflight(projectPath=...)'],
        });
      }

      const preflight = await callBaseTool(baseHandlers, 'godot_preflight', {
        projectPath,
      });
      if (!preflight.ok) {
        issues.push({
          issueId: 'PREFLIGHT_FAILED',
          severity: 'error',
          category: 'environment',
          title: 'Preflight failed',
          message: preflight.summary ?? 'Preflight failed',
          evidence:
            preflight.details && typeof preflight.details === 'object'
              ? JSON.stringify(preflight.details.checks ?? {}, null, 2)
              : undefined,
          suggestedFix:
            'Verify GODOT_PATH, projectPath, and headless execution environment.',
          relatedMcpActions: ['godot_preflight(projectPath=...)'],
        });
      }

      // Asset/import scan (headless fallback uses godot_import_project_assets)
      if (normalizedOptions.includeAssets) {
        const importResp = await callBaseTool(
          baseHandlers,
          'godot_import_project_assets',
          {
            projectPath,
          },
        );

        if (!importResp.ok) {
          issues.push({
            issueId: 'IMPORT_SCAN_FAILED',
            severity: 'warning',
            category: 'assets',
            title: 'Asset import scan failed',
            message: importResp.summary ?? 'Asset import scan failed',
            suggestedFix:
              'Run a headless import (--import) or open the project in the editor once to refresh imports.',
            relatedMcpActions: [
              'godot_asset_manager(action="auto_import_check")',
            ],
          });
        }

        const logLines = Array.isArray(importResp.logs) ? importResp.logs : [];
        const errorLines = logLines
          .map((l) => String(l))
          .filter((l) => /error|failed|exception|parse error/iu.test(l))
          .slice(0, 50);
        for (const line of errorLines) {
          issues.push({
            issueId: 'IMPORT_LOG_ERROR',
            severity: 'warning',
            category: 'assets',
            title: 'Import pipeline reported an error',
            message: line,
            relatedMcpActions: [
              'godot_asset_manager(action="auto_import_check")',
            ],
          });
        }
      }

      // Headless doctor scan (single-process JSON output from godot_operations.gd)
      let meta: DoctorScanMeta | null = null;
      const scanResp = await callBaseTool(baseHandlers, 'godot_headless_op', {
        projectPath,
        operation: 'doctor_scan_v1',
        params: {
          include_assets: normalizedOptions.includeAssets,
          include_scripts: normalizedOptions.includeScripts,
          include_scenes: normalizedOptions.includeScenes,
          include_uid: normalizedOptions.includeUID,
          include_export: normalizedOptions.includeExport,
          max_issues_per_category: normalizedOptions.maxIssuesPerCategory,
          time_budget_ms: normalizedOptions.timeBudgetMs,
          deep_scene_instantiate: normalizedOptions.deepSceneInstantiate,
        },
      });

      if (scanResp.ok) {
        const details =
          scanResp.details &&
          typeof scanResp.details === 'object' &&
          !Array.isArray(scanResp.details)
            ? (scanResp.details as Record<string, unknown>)
            : null;
        const rawMeta = details?.meta;
        meta =
          rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
            ? (rawMeta as DoctorScanMeta)
            : null;
        const rawIssues = details?.issues;
        issues.push(...normalizeIssues(rawIssues));
      } else {
        issues.push({
          issueId: 'DOCTOR_SCAN_FAILED',
          severity: 'error',
          category: 'environment',
          title: 'Headless doctor scan failed',
          message: scanResp.summary ?? 'Headless doctor scan failed',
          suggestedFix:
            'Ensure GODOT_PATH is valid and the project can be loaded headlessly.',
        });
      }

      const report = buildDoctorReport({
        projectPath,
        godotVersion,
        options,
        meta,
        issues,
      });

      const markdown = renderDoctorReportMarkdown(report);
      let absReportPath: string;
      let reportPolicy: 'project' | 'dangerous_external';
      try {
        const resolved = resolveDoctorReportPath(
          projectPath,
          reportRelativePath,
        );
        absReportPath = resolved.absPath;
        reportPolicy = resolved.policy;
      } catch (error) {
        return {
          ok: false,
          summary:
            error instanceof Error
              ? error.message
              : 'Invalid reportRelativePath',
          details: {
            reportRelativePath,
            suggestions: [
              'Use a path under the project root (recommended: .godot_mcp/reports/doctor_report.md).',
              'If you really need an external path, set ALLOW_DANGEROUS_OPS=true.',
            ],
          },
        };
      }

      await fs.mkdir(path.dirname(absReportPath), { recursive: true });
      await fs.writeFile(absReportPath, markdown, 'utf8');

      const previewLines = markdown.split(/\r?\n/u).slice(0, 250).join('\n');

      return {
        ok: true,
        summary: 'Doctor report generated',
        details: {
          reportPath: absReportPath,
          reportPolicy,
          summary: report.summary,
          topIssues: getTopIssues(report.issues, 10),
          reportPreview: previewLines,
        },
      };
    }

    return supportedActionError(
      'godot_workspace_manager',
      actionRaw,
      supportedActions,
    );
  };
}
