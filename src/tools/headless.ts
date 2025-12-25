import path from 'path';
import { existsSync } from 'fs';

import { executeHeadlessOperation } from '../headless_ops.js';
import { execGodot } from '../godot_cli.js';
import { resolveInsideProject } from '../security.js';
import { assertDangerousOpsAllowed } from '../security.js';
import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalRecordOrJson,
  asOptionalString,
  asRecord,
  ValidationError,
  valueType,
} from '../validation.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';

const GODOT_DEBUG_MODE = true;

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

function isGodot44OrLater(versionText: string): boolean {
  const match = versionText.match(/(\d+)\.(\d+)/u);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (Number.isNaN(major) || Number.isNaN(minor)) return false;
  return major > 4 || (major === 4 && minor >= 4);
}

function validateHeadlessOpPaths(
  operation: string,
  params: Record<string, unknown>,
  projectPath: string,
): void {
  const getString = (key: string): string | undefined => {
    const v = params[key];
    return typeof v === 'string' ? v : undefined;
  };

  const validate = (p?: string) => {
    if (!p) return;
    resolveInsideProject(projectPath, p);
  };

  const op = operation;

  if (
    op === 'create_scene' ||
    op === 'add_node' ||
    op === 'save_scene' ||
    op === 'set_node_properties' ||
    op === 'connect_signal' ||
    op === 'validate_scene'
  ) {
    validate(getString('scenePath') ?? getString('scene_path'));
  }

  if (op === 'load_sprite') {
    validate(getString('scenePath') ?? getString('scene_path'));
    validate(getString('texturePath') ?? getString('texture_path'));
  }

  if (op === 'export_mesh_library') {
    validate(getString('scenePath') ?? getString('scene_path'));
    validate(getString('outputPath') ?? getString('output_path'));
  }

  if (op === 'save_scene')
    validate(getString('newPath') ?? getString('new_path'));
  if (op === 'get_uid')
    validate(getString('filePath') ?? getString('file_path'));

  if (op === 'attach_script') {
    validate(getString('scenePath') ?? getString('scene_path'));
    validate(getString('scriptPath') ?? getString('script_path'));
  }

  if (op === 'create_script')
    validate(getString('scriptPath') ?? getString('script_path'));

  if (op === 'read_text_file' || op === 'write_text_file')
    validate(getString('path'));
  if (op === 'create_resource')
    validate(getString('resourcePath') ?? getString('resource_path'));
}

async function runHeadlessOp(
  ctx: ServerContext,
  operation: string,
  params: Record<string, unknown>,
  projectPath: string,
): Promise<ToolResponse> {
  ctx.assertValidProject(projectPath);
  assertDangerousOpsAllowed(operation);
  validateHeadlessOpPaths(operation, params, projectPath);

  const godotPath = await ctx.ensureGodotPath();
  const snakeParams = ctx.convertCamelToSnakeCase(params) as Record<
    string,
    unknown
  >;

  const result = await executeHeadlessOperation({
    godotPath,
    projectPath,
    operationsScriptPath: ctx.operationsScriptPath,
    operation,
    params: snakeParams,
    godotDebugMode: GODOT_DEBUG_MODE,
    debug: (m) => ctx.logDebug(m),
  });

  const logs = [
    ...splitLines(result.stdout),
    ...splitLines(result.stderr).map((l) => `[stderr] ${l}`),
  ];

  if (
    result.parsed &&
    typeof result.parsed.ok === 'boolean' &&
    typeof result.parsed.summary === 'string'
  ) {
    return {
      ok: result.parsed.ok,
      summary: result.parsed.summary,
      details:
        (result.parsed.details as Record<string, unknown>) ??
        ({ operation, exitCode: result.exitCode } as Record<string, unknown>),
      logs:
        (Array.isArray(result.parsed.logs) ? result.parsed.logs : undefined) ??
        logs,
    };
  }

  const ok = result.exitCode === 0;
  return {
    ok,
    summary: ok ? `${operation} succeeded` : `${operation} failed`,
    details: { operation, exitCode: result.exitCode },
    logs,
  };
}

type BatchStep = {
  operation: string;
  params: Record<string, unknown>;
};

async function runHeadlessBatch(
  ctx: ServerContext,
  projectPath: string,
  steps: BatchStep[],
  stopOnError: boolean,
): Promise<ToolResponse> {
  ctx.assertValidProject(projectPath);

  const validatedSteps = steps.map((step) => {
    assertDangerousOpsAllowed(step.operation);
    validateHeadlessOpPaths(step.operation, step.params, projectPath);
    return {
      operation: step.operation,
      params: ctx.convertCamelToSnakeCase(step.params) as Record<
        string,
        unknown
      >,
    };
  });

  const godotPath = await ctx.ensureGodotPath();
  const result = await executeHeadlessOperation({
    godotPath,
    projectPath,
    operationsScriptPath: ctx.operationsScriptPath,
    operation: 'batch',
    params: { steps: validatedSteps, stop_on_error: stopOnError },
    godotDebugMode: GODOT_DEBUG_MODE,
    debug: (m) => ctx.logDebug(m),
  });

  const logs = [
    ...splitLines(result.stdout),
    ...splitLines(result.stderr).map((l) => `[stderr] ${l}`),
  ];

  if (
    result.parsed &&
    typeof result.parsed.ok === 'boolean' &&
    typeof result.parsed.summary === 'string'
  ) {
    const detailsObj =
      result.parsed.details &&
      typeof result.parsed.details === 'object' &&
      !Array.isArray(result.parsed.details)
        ? (result.parsed.details as Record<string, unknown>)
        : {};

    const results = Array.isArray(detailsObj.results) ? detailsObj.results : [];
    const failedIndex =
      typeof detailsObj.failed_index === 'number' &&
      Number.isInteger(detailsObj.failed_index) &&
      detailsObj.failed_index >= 0
        ? detailsObj.failed_index
        : undefined;

    return {
      ok: result.parsed.ok,
      summary: result.parsed.summary,
      details: {
        results,
        ...(failedIndex === undefined ? {} : { failedIndex }),
      },
      logs:
        (Array.isArray(result.parsed.logs) ? result.parsed.logs : undefined) ??
        logs,
    };
  }

  const ok = result.exitCode === 0;
  return {
    ok,
    summary: ok ? `batch succeeded` : `batch failed`,
    details: { operation: 'batch', exitCode: result.exitCode },
    logs,
  };
}

export function createHeadlessToolHandlers(
  ctx: ServerContext,
): Record<string, ToolHandler> {
  return {
    godot_headless_op: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      const operation = asNonEmptyString(argsObj.operation, 'operation');
      const params = asOptionalRecordOrJson(argsObj.params, 'params', {});
      return await runHeadlessOp(ctx, operation, params, projectPath);
    },

    godot_headless_batch: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');

      const stepsValue = argsObj.steps;
      if (!Array.isArray(stepsValue)) {
        throw new ValidationError(
          'steps',
          `Invalid field "steps": expected array, got ${valueType(stepsValue)}`,
          valueType(stepsValue),
        );
      }

      const stopOnError =
        asOptionalBoolean(
          argsObj.stopOnError ??
            (argsObj as Record<string, unknown>).stop_on_error,
          'stopOnError',
        ) ?? true;

      const steps: BatchStep[] = stepsValue.map((value, index) => {
        const stepObj = asRecord(value, `steps[${index}]`);
        const operation = asNonEmptyString(
          stepObj.operation,
          `steps[${index}].operation`,
        );
        const params = asOptionalRecordOrJson(
          stepObj.params,
          `steps[${index}].params`,
          {},
        );
        return { operation, params };
      });

      return await runHeadlessBatch(ctx, projectPath, steps, stopOnError);
    },

    create_scene: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asOptionalString(argsObj.projectPath, 'projectPath');
      const scenePath = asOptionalString(argsObj.scenePath, 'scenePath');
      const rootNodeType = asOptionalString(
        argsObj.rootNodeType,
        'rootNodeType',
      );
      if (!projectPath || !scenePath) {
        return { ok: false, summary: 'projectPath and scenePath are required' };
      }

      try {
        const absScene = resolveInsideProject(projectPath, scenePath);
        const res = await runHeadlessOp(
          ctx,
          'create_scene',
          { scenePath, rootNodeType: rootNodeType ?? 'Node2D' },
          projectPath,
        );
        if (!res.ok) {
          res.details = {
            ...(res.details ?? {}),
            suggestions: [
              'Check if rootNodeType is valid',
              `Target file: ${absScene}`,
            ],
          };
        }
        return res;
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to create scene: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    add_node: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asOptionalString(argsObj.projectPath, 'projectPath');
      const scenePath = asOptionalString(argsObj.scenePath, 'scenePath');
      const nodeType = asOptionalString(argsObj.nodeType, 'nodeType');
      const nodeName = asOptionalString(argsObj.nodeName, 'nodeName');
      const parentNodePath = asOptionalString(
        argsObj.parentNodePath,
        'parentNodePath',
      );
      if (!projectPath || !scenePath || !nodeType || !nodeName) {
        return {
          ok: false,
          summary: 'projectPath, scenePath, nodeType, nodeName are required',
        };
      }

      try {
        const absScene = resolveInsideProject(projectPath, scenePath);
        if (!existsSync(absScene)) {
          return {
            ok: false,
            summary: `Scene file does not exist: ${scenePath}`,
            details: {
              suggestions: [
                'Run create_scene first',
                `Expected path: ${absScene}`,
              ],
            },
          };
        }

        const params: Record<string, unknown> = {
          scenePath,
          parentNodePath: parentNodePath ?? 'root',
          nodeType,
          nodeName,
        };
        if (argsObj.properties) params.properties = argsObj.properties;

        return await runHeadlessOp(ctx, 'add_node', params, projectPath);
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to add node: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    load_sprite: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asOptionalString(argsObj.projectPath, 'projectPath');
      const scenePath = asOptionalString(argsObj.scenePath, 'scenePath');
      const nodePath = asOptionalString(argsObj.nodePath, 'nodePath');
      const texturePath = asOptionalString(argsObj.texturePath, 'texturePath');
      if (!projectPath || !scenePath || !nodePath || !texturePath) {
        return {
          ok: false,
          summary: 'projectPath, scenePath, nodePath, texturePath are required',
        };
      }

      try {
        return await runHeadlessOp(
          ctx,
          'load_sprite',
          { scenePath, nodePath, texturePath },
          projectPath,
        );
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to load sprite: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    export_mesh_library: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asOptionalString(argsObj.projectPath, 'projectPath');
      const scenePath = asOptionalString(argsObj.scenePath, 'scenePath');
      const outputPath = asOptionalString(argsObj.outputPath, 'outputPath');
      if (!projectPath || !scenePath || !outputPath) {
        return {
          ok: false,
          summary: 'projectPath, scenePath, outputPath are required',
        };
      }

      try {
        const params: Record<string, unknown> = { scenePath, outputPath };
        if (argsObj.meshItemNames) params.meshItemNames = argsObj.meshItemNames;
        return await runHeadlessOp(
          ctx,
          'export_mesh_library',
          params,
          projectPath,
        );
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to export mesh library: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    save_scene: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asOptionalString(argsObj.projectPath, 'projectPath');
      const scenePath = asOptionalString(argsObj.scenePath, 'scenePath');
      const newPath = asOptionalString(argsObj.newPath, 'newPath');
      if (!projectPath || !scenePath) {
        return { ok: false, summary: 'projectPath and scenePath are required' };
      }

      try {
        const params: Record<string, unknown> = { scenePath };
        if (newPath) params.newPath = newPath;
        return await runHeadlessOp(ctx, 'save_scene', params, projectPath);
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to save scene: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    get_uid: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asOptionalString(argsObj.projectPath, 'projectPath');
      const filePath = asOptionalString(argsObj.filePath, 'filePath');
      if (!projectPath || !filePath) {
        return { ok: false, summary: 'projectPath and filePath are required' };
      }

      try {
        ctx.assertValidProject(projectPath);
        resolveInsideProject(projectPath, filePath);

        const godotPath = await ctx.ensureGodotPath();
        const { stdout: versionStdout } = await execGodot(godotPath, [
          '--version',
        ]);
        const version = versionStdout.trim();
        if (!isGodot44OrLater(version)) {
          return {
            ok: false,
            summary: `UIDs require Godot 4.4+. Current: ${version}`,
          };
        }

        return await runHeadlessOp(ctx, 'get_uid', { filePath }, projectPath);
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to get UID: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    update_project_uids: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asOptionalString(argsObj.projectPath, 'projectPath');
      if (!projectPath)
        return { ok: false, summary: 'projectPath is required' };

      try {
        ctx.assertValidProject(projectPath);

        const godotPath = await ctx.ensureGodotPath();
        const { stdout: versionStdout } = await execGodot(godotPath, [
          '--version',
        ]);
        const version = versionStdout.trim();
        if (!isGodot44OrLater(version)) {
          return {
            ok: false,
            summary: `UIDs require Godot 4.4+. Current: ${version}`,
          };
        }

        return await runHeadlessOp(
          ctx,
          'resave_resources',
          { projectPath },
          projectPath,
        );
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to update project UIDs: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
