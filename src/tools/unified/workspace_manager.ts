import path from 'path';
import fs from 'fs/promises';

import axios from 'axios';

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
    const timeoutMs = asOptionalNumber(argsObj.timeoutMs, 'timeoutMs');

    const supportedActions = [
      'launch',
      'connect',
      'status',
      'run',
      'stop',
      'smoke_test',
      'new_scene',
      'open_scene',
      'save_scene',
      'save_all',
      'restart',
      'get_state',
      'guidelines.search',
      'guidelines.get_section',
      'docs.search',
      'docs.get_class',
      'doctor_report',
    ];

    const fileExists = async (absPath: string): Promise<boolean> => {
      try {
        await fs.stat(absPath);
        return true;
      } catch {
        return false;
      }
    };

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

    if (action === 'new_scene') {
      const projectPath = maybeGetString(
        argsObj,
        ['projectPath', 'project_path'],
        'projectPath',
      );
      const scenePath = maybeGetString(
        argsObj,
        ['scenePath', 'scene_path', 'path'],
        'scenePath',
      );
      if (!projectPath || !scenePath) {
        return {
          ok: false,
          summary: 'new_scene requires projectPath and scenePath',
          details: { required: ['projectPath', 'scenePath'] },
        };
      }
      ctx.assertValidProject(projectPath);

      const rootNodeType =
        maybeGetString(
          argsObj,
          ['rootNodeType', 'root_type', 'rootType'],
          'rootNodeType',
        ) ?? 'Node3D';

      const steps: ToolResponse[] = [];
      const create = await callBaseTool(baseHandlers, 'create_scene', {
        projectPath,
        scenePath,
        rootNodeType,
      });
      steps.push(create);
      if (!create.ok) return create;

      if (hasEditorConnection(ctx)) {
        const rpcParams: Record<string, unknown> = { path: scenePath };
        assertEditorRpcAllowed(
          'open_scene',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        const openResp = await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'open_scene', params: rpcParams },
        });
        steps.push(openResp);
        if (!openResp.ok) {
          return {
            ok: false,
            summary: 'new_scene created but failed to open in editor',
            details: { projectPath, scenePath, rootNodeType, steps },
          };
        }
      }

      return {
        ok: true,
        summary: 'new_scene completed',
        details: { projectPath, scenePath, rootNodeType, steps },
      };
    }

    if (action === 'save_scene') {
      return await callBaseTool(baseHandlers, 'save_scene', { ...argsObj });
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

    if (action === 'get_state') {
      if (!hasEditorConnection(ctx)) return requireEditorConnected('get_state');

      assertEditorRpcAllowed(
        'get_current_scene',
        {},
        ctx.getEditorProjectPath() ?? '',
      );
      const current = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'get_current_scene', params: {} },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      if (!current.ok) return current;

      assertEditorRpcAllowed(
        'list_open_scenes',
        {},
        ctx.getEditorProjectPath() ?? '',
      );
      const openScenes = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'list_open_scenes', params: {} },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      if (!openScenes.ok) return openScenes;

      return {
        ok: true,
        summary: 'get_state ok',
        details: { current, openScenes },
      };
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

    if (action === 'smoke_test') {
      const projectPath = maybeGetString(
        argsObj,
        ['projectPath', 'project_path'],
        'projectPath',
      );
      if (!projectPath) {
        return {
          ok: false,
          summary: 'smoke_test requires projectPath',
          details: { required: ['projectPath'] },
        };
      }
      ctx.assertValidProject(projectPath);

      const scene =
        maybeGetString(
          argsObj,
          ['scene', 'scenePath', 'scene_path'],
          'scene',
        ) ?? undefined;
      if (scene) ctx.ensureNoTraversal(scene);

      const waitMs = Math.floor(
        asOptionalNumber(
          (argsObj as Record<string, unknown>).waitMs,
          'waitMs',
        ) ?? 1500,
      );
      const failOnIssues =
        asOptionalBoolean(
          (argsObj as Record<string, unknown>).failOnIssues,
          'failOnIssues',
        ) ?? true;

      const runResp = await callBaseTool(baseHandlers, 'run_project', {
        projectPath,
        headless: true,
        ...(scene ? { scene } : {}),
      });
      if (!runResp.ok) return runResp;

      await new Promise((resolve) => setTimeout(resolve, waitMs));

      const debugResp = await callBaseTool(
        baseHandlers,
        'get_debug_output',
        {},
      );
      const stopResp = await callBaseTool(baseHandlers, 'stop_project', {});

      const outLines =
        debugResp.ok &&
        debugResp.details &&
        typeof debugResp.details === 'object' &&
        !Array.isArray(debugResp.details) &&
        Array.isArray((debugResp.details as Record<string, unknown>).output)
          ? ((debugResp.details as Record<string, unknown>).output as unknown[])
              .filter((v): v is string => typeof v === 'string')
              .filter((v) => v.trim().length > 0)
          : [];
      const errLines =
        debugResp.ok &&
        debugResp.details &&
        typeof debugResp.details === 'object' &&
        !Array.isArray(debugResp.details) &&
        Array.isArray((debugResp.details as Record<string, unknown>).errors)
          ? ((debugResp.details as Record<string, unknown>).errors as unknown[])
              .filter((v): v is string => typeof v === 'string')
              .filter((v) => v.trim().length > 0)
          : [];

      const issues = [...outLines, ...errLines].filter((line) =>
        /error|exception|panic|failed|parse error/iu.test(line),
      );

      if (failOnIssues && issues.length > 0) {
        return {
          ok: false,
          summary: 'Smoke test found error-like output',
          details: {
            projectPath,
            headless: true,
            waitMs,
            scene: scene ?? null,
            issues,
            debug: debugResp,
            stop: stopResp,
          },
        };
      }

      return {
        ok: true,
        summary:
          issues.length > 0
            ? 'Smoke test completed (issues found)'
            : 'Smoke test completed',
        details: {
          projectPath,
          headless: true,
          waitMs,
          scene: scene ?? null,
          issues,
          debug: debugResp,
          stop: stopResp,
        },
      };
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

    if (action === 'guidelines.search' || action === 'guidelines.get_section') {
      const projectPath = maybeGetString(
        argsObj,
        ['projectPath', 'project_path'],
        'projectPath',
      );
      if (!projectPath) {
        return {
          ok: false,
          summary: `${action} requires projectPath`,
          details: { required: ['projectPath'] },
        };
      }
      ctx.assertValidProject(projectPath);

      const filePathInput =
        asOptionalString(
          (argsObj as Record<string, unknown>).guidelinesFilePath,
          'guidelinesFilePath',
        )?.trim() ?? null;

      const candidateRelPaths = filePathInput
        ? [filePathInput]
        : [
            'AI_GUIDELINES.md',
            'docs/AI_GUIDELINES.md',
            '.godot_mcp/AI_GUIDELINES.md',
          ];

      let absGuidelinesPath: string | null = null;
      let resGuidelinesPath: string | null = null;

      for (const rel of candidateRelPaths) {
        try {
          const abs = resolveInsideProject(projectPath, rel);
          if (!(await fileExists(abs))) continue;
          absGuidelinesPath = abs;
          const relFromProject = path
            .relative(path.resolve(projectPath), abs)
            .split(path.sep)
            .join('/');
          resGuidelinesPath = `res://${relFromProject}`;
          break;
        } catch {
          continue;
        }
      }

      if (!absGuidelinesPath || !resGuidelinesPath) {
        return {
          ok: false,
          summary: 'AI guidelines file not found',
          error: {
            code: 'E_NOT_FOUND',
            message: 'AI guidelines file not found',
            details: {
              tried: candidateRelPaths,
              suggestion:
                'Create AI_GUIDELINES.md in the project root (or pass guidelinesFilePath).',
            },
            retryable: true,
            suggestedFix: 'Create AI_GUIDELINES.md and retry.',
          },
          details: { tried: candidateRelPaths },
          logs: [],
        };
      }

      const raw = await fs.readFile(absGuidelinesPath, 'utf8');
      const lines = raw.replace(/\r\n/gu, '\n').split('\n');

      const maxMatches = Math.max(
        1,
        Math.min(
          100,
          Math.floor(asOptionalNumber(argsObj.maxMatches, 'maxMatches') ?? 10),
        ),
      );
      const maxChars = Math.max(
        200,
        Math.min(
          100_000,
          Math.floor(asOptionalNumber(argsObj.maxChars, 'maxChars') ?? 12_000),
        ),
      );

      if (action === 'guidelines.search') {
        const query = asNonEmptyString(argsObj.query, 'query');
        const needle = query.toLowerCase();

        const matches: Array<Record<string, unknown>> = [];
        for (let i = 0; i < lines.length; i += 1) {
          if (matches.length >= maxMatches) break;
          const line = lines[i];
          if (!line.toLowerCase().includes(needle)) continue;

          let section: string | null = null;
          for (let j = i; j >= 0; j -= 1) {
            const m = lines[j].match(/^#{1,6}\s+(.+)$/u);
            if (m) {
              section = m[1].trim();
              break;
            }
          }

          matches.push({
            lineNumber: i + 1,
            line: line.trim(),
            section,
            context: {
              before: lines[Math.max(0, i - 1)]?.trim() ?? '',
              after: lines[Math.min(lines.length - 1, i + 1)]?.trim() ?? '',
            },
          });
        }

        return {
          ok: true,
          summary:
            matches.length > 0
              ? 'guidelines.search ok'
              : 'guidelines.search (no matches)',
          details: {
            projectPath,
            filePath: resGuidelinesPath,
            query,
            maxMatches,
            matches,
          },
          logs: [],
        };
      }

      const section = asNonEmptyString(argsObj.section, 'section').trim();

      let startIndex = -1;
      let startLevel = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const m = lines[i].match(/^(#{1,6})\s+(.+)$/u);
        if (!m) continue;
        const level = m[1].length;
        const title = m[2].trim();
        if (title === section) {
          startIndex = i;
          startLevel = level;
          break;
        }
      }

      if (startIndex === -1) {
        return {
          ok: false,
          summary: `Section not found: ${section}`,
          error: {
            code: 'E_NOT_FOUND',
            message: `Section not found: ${section}`,
            details: { section, filePath: resGuidelinesPath },
            retryable: true,
            suggestedFix:
              'Call guidelines.search first to find the exact section heading.',
          },
          details: { section, filePath: resGuidelinesPath },
          logs: [],
        };
      }

      let endIndex = lines.length;
      for (let i = startIndex + 1; i < lines.length; i += 1) {
        const m = lines[i].match(/^(#{1,6})\s+(.+)$/u);
        if (!m) continue;
        const level = m[1].length;
        if (level <= startLevel) {
          endIndex = i;
          break;
        }
      }

      const extracted = lines.slice(startIndex, endIndex).join('\n').trim();
      const truncated = extracted.length > maxChars;
      const text = truncated
        ? `${extracted.slice(0, maxChars)}\n\n[TRUNCATED]`
        : extracted;

      return {
        ok: true,
        summary: truncated
          ? 'guidelines.get_section ok (truncated)'
          : 'guidelines.get_section ok',
        details: {
          projectPath,
          filePath: resGuidelinesPath,
          section,
          maxChars,
          truncated,
          text,
        },
        logs: [],
      };
    }

    if (action === 'docs.search') {
      const query = asNonEmptyString(argsObj.query, 'query');
      const maxResults = Math.max(
        1,
        Math.min(
          25,
          Math.floor(asOptionalNumber(argsObj.maxResults, 'maxResults') ?? 10),
        ),
      );

      const searchUrl = `https://docs.godotengine.org/en/stable/search.html?q=${encodeURIComponent(query)}`;
      const apiUrl = `https://docs.godotengine.org/en/stable/_/api/v2/search/?q=${encodeURIComponent(query)}&project=godot&version=stable&language=en`;

      try {
        const resp = await axios.get(apiUrl, {
          timeout: 10_000,
          responseType: 'json',
          headers: { 'User-Agent': 'godot-mcp-omni' },
        });

        const data = resp.data as unknown;
        const resultsRaw =
          data && typeof data === 'object' && !Array.isArray(data)
            ? (data as Record<string, unknown>).results
            : null;
        const results = Array.isArray(resultsRaw) ? resultsRaw : [];

        const candidates: Array<Record<string, unknown>> = [];
        for (const item of results.slice(0, maxResults)) {
          if (!item || typeof item !== 'object' || Array.isArray(item))
            continue;
          const obj = item as Record<string, unknown>;
          const title = typeof obj.title === 'string' ? obj.title.trim() : '';
          const pathValue = typeof obj.path === 'string' ? obj.path.trim() : '';
          const highlights =
            obj.highlights &&
            typeof obj.highlights === 'object' &&
            !Array.isArray(obj.highlights)
              ? (obj.highlights as Record<string, unknown>)
              : null;
          const contentArr =
            highlights && Array.isArray(highlights.content)
              ? highlights.content
              : [];
          const excerptRaw =
            contentArr.length > 0 && typeof contentArr[0] === 'string'
              ? contentArr[0]
              : '';
          const excerpt = excerptRaw
            .replace(/<[^>]+>/gu, ' ')
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 240);
          candidates.push({
            title,
            path: pathValue,
            url: pathValue
              ? `https://docs.godotengine.org/en/stable/${pathValue}`
              : null,
            excerpt: excerpt ? excerpt : null,
          });
        }

        return {
          ok: true,
          summary:
            candidates.length > 0
              ? 'docs.search ok'
              : 'docs.search (no results)',
          details: {
            query,
            maxResults,
            searchUrl,
            candidates,
          },
          logs: [],
        };
      } catch (error) {
        return {
          ok: false,
          summary: 'docs.search failed',
          error: {
            code: 'E_INTERNAL',
            message: error instanceof Error ? error.message : String(error),
            details: { apiUrl, searchUrl },
            retryable: true,
            suggestedFix:
              'Check network access and retry (or open searchUrl in a browser).',
          },
          details: { apiUrl, searchUrl },
          logs: [],
        };
      }
    }

    if (action === 'docs.get_class') {
      const className = asNonEmptyString(argsObj.className, 'className');
      const maxChars = Math.max(
        200,
        Math.min(
          100_000,
          Math.floor(asOptionalNumber(argsObj.maxChars, 'maxChars') ?? 12_000),
        ),
      );

      const classLower = className.toLowerCase().replace(/\s+/gu, '');
      const url = `https://docs.godotengine.org/en/stable/classes/class_${encodeURIComponent(
        classLower,
      )}.html`;

      const stripTags = (html: string): string =>
        html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/giu, ' ')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/giu, ' ')
          .replace(/<[^>]+>/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim();

      const decodeEntities = (text: string): string =>
        text
          .replace(/&lt;/gu, '<')
          .replace(/&gt;/gu, '>')
          .replace(/&amp;/gu, '&')
          .replace(/&quot;/gu, '"')
          .replace(/&#39;/gu, "'");

      const extractSection = (html: string, id: string): string | null => {
        const re = new RegExp(
          `<section[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/section>`,
          'iu',
        );
        const m = re.exec(html);
        return m?.[1] ? m[1] : null;
      };

      const extractFirstParagraph = (sectionHtml: string): string | null => {
        const re = /<p[^>]*>([\s\S]*?)<\/p>/iu;
        const m = re.exec(sectionHtml);
        if (!m?.[1]) return null;
        return decodeEntities(stripTags(m[1]));
      };

      const extractTableRows = (
        sectionHtml: string,
        maxRows: number,
      ): Array<string[]> => {
        const tableMatch = /<table[^>]*>([\s\S]*?)<\/table>/iu.exec(
          sectionHtml,
        );
        if (!tableMatch?.[1]) return [];
        const tableHtml = tableMatch[1];
        const rows = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/giu) ?? [];
        const out: Array<string[]> = [];
        for (const row of rows.slice(0, maxRows)) {
          const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/giu) ?? [];
          const texts = cells
            .map((c) => /<td[^>]*>([\s\S]*?)<\/td>/iu.exec(c)?.[1] ?? '')
            .map((c) => decodeEntities(stripTags(c)))
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
          if (texts.length > 0) out.push(texts);
        }
        return out;
      };

      try {
        const resp = await axios.get(url, {
          timeout: 10_000,
          responseType: 'text',
          headers: { 'User-Agent': 'godot-mcp-omni' },
          validateStatus: (s) => s >= 200 && s < 500,
        });

        if (resp.status === 404) {
          return {
            ok: false,
            summary: `Class not found: ${className}`,
            error: {
              code: 'E_NOT_FOUND',
              message: `Class not found: ${className}`,
              details: { className, url },
              retryable: true,
              suggestedFix: 'Check spelling or call docs.search first.',
            },
            details: { className, url },
            logs: [],
          };
        }

        const html = String(resp.data ?? '');

        const inheritsMatch = /<p[^>]*>\s*Inherits:\s*([\s\S]*?)<\/p>/iu.exec(
          html,
        );
        const inherits = inheritsMatch?.[1]
          ? decodeEntities(stripTags(inheritsMatch[1]))
          : null;

        const descriptionSection = extractSection(html, 'description');
        const description = descriptionSection
          ? extractFirstParagraph(descriptionSection)
          : null;

        const propertiesSection = extractSection(html, 'properties');
        const propertiesRows = propertiesSection
          ? extractTableRows(propertiesSection, 10)
          : [];
        const properties = propertiesRows
          .map((cells) =>
            cells.length >= 2 ? { type: cells[0], name: cells[1] } : null,
          )
          .filter((v): v is { type: string; name: string } => Boolean(v));

        const methodsSection = extractSection(html, 'methods');
        const methodRows = methodsSection
          ? extractTableRows(methodsSection, 15)
          : [];
        const methods = methodRows
          .map((cells) =>
            cells.length >= 2
              ? { returnType: cells[0], signature: cells[1] }
              : null,
          )
          .filter((v): v is { returnType: string; signature: string } =>
            Boolean(v),
          );

        const signalsSection = extractSection(html, 'signals');
        const signals = signalsSection
          ? (
              signalsSection.match(
                /<dt[^>]*class=["']sig["'][^>]*>([\s\S]*?)<\/dt>/giu,
              ) ?? []
            )
              .slice(0, 8)
              .map(
                (dt) =>
                  /<dt[^>]*class=["']sig["'][^>]*>([\s\S]*?)<\/dt>/iu.exec(
                    dt,
                  )?.[1] ?? '',
              )
              .map((t) => decodeEntities(stripTags(t)))
              .filter((t) => t.trim().length > 0)
          : [];

        const body = [
          inherits ? `Inherits: ${inherits}` : null,
          description ? `Description: ${description}` : null,
        ]
          .filter((v): v is string => typeof v === 'string')
          .join('\n');
        const truncated = body.length > maxChars;

        return {
          ok: true,
          summary: truncated
            ? 'docs.get_class ok (truncated)'
            : 'docs.get_class ok',
          details: {
            className,
            url,
            inherits,
            description: description
              ? description.length > maxChars
                ? `${description.slice(0, maxChars)}…`
                : description
              : null,
            properties,
            methods,
            signals,
            maxChars,
            truncated,
          },
          logs: [],
        };
      } catch (error) {
        return {
          ok: false,
          summary: 'docs.get_class failed',
          error: {
            code: 'E_INTERNAL',
            message: error instanceof Error ? error.message : String(error),
            details: { className, url },
            retryable: true,
            suggestedFix:
              'Check network access and retry (or open url in a browser).',
          },
          details: { className, url },
          logs: [],
        };
      }
    }

    return supportedActionError(
      'godot_workspace_manager',
      actionRaw,
      supportedActions,
    );
  };
}
