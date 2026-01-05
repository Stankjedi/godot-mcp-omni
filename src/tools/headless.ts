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
    op === 'create_node_bundle' ||
    op === 'generate_terrain_mesh' ||
    op === 'save_scene' ||
    op === 'set_node_properties' ||
    op === 'rename_node' ||
    op === 'move_node' ||
    op === 'create_simple_animation' ||
    op === 'connect_signal' ||
    op === 'instance_scene' ||
    op === 'create_tilemap' ||
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

  if (op === 'instance_scene') {
    validate(
      getString('sourceScenePath') ??
        getString('source_scene_path') ??
        getString('instanceScenePath') ??
        getString('instance_scene_path'),
    );
  }

  if (op === 'create_tilemap') {
    validate(getString('tileSetPath') ?? getString('tile_set_path'));
    validate(
      getString('tileSetTexturePath') ?? getString('tile_set_texture_path'),
    );
  }

  if (op === 'op_tileset_create_from_atlas') {
    validate(getString('pngPath') ?? getString('png_path'));
    validate(
      getString('outputTilesetPath') ?? getString('output_tileset_path'),
    );
  }

  if (
    op === 'op_world_scene_ensure_layers' ||
    op === 'op_world_generate_tiles' ||
    op === 'op_place_objects_tile' ||
    op === 'op_place_objects_scene_instances' ||
    op === 'op_export_preview'
  ) {
    validate(getString('scenePath') ?? getString('scene_path'));
  }

  if (op === 'op_export_preview') {
    validate(
      getString('outputPngPath') ??
        getString('output_png_path') ??
        getString('outputPath') ??
        getString('output_path'),
    );
  }

  if (
    op === 'op_world_scene_ensure_layers' ||
    op === 'op_world_generate_tiles'
  ) {
    validate(getString('tilesetPath') ?? getString('tileset_path'));
  }

  if (op === 'op_place_objects_scene_instances') {
    const objects = params.objects;
    if (Array.isArray(objects)) {
      for (const raw of objects) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const obj = raw as Record<string, unknown>;
        const scene =
          (typeof obj.scenePath === 'string' ? obj.scenePath : undefined) ??
          (typeof obj.scene_path === 'string' ? obj.scene_path : undefined);
        validate(scene);
      }
    }
  }
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
      const ensureUniqueName = asOptionalBoolean(
        (argsObj as Record<string, unknown>).ensureUniqueName ??
          (argsObj as Record<string, unknown>).ensure_unique_name,
        'ensureUniqueName',
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
        if (ensureUniqueName !== undefined)
          params.ensureUniqueName = ensureUniqueName;

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
        const first = await runHeadlessOp(
          ctx,
          'load_sprite',
          { scenePath, nodePath, texturePath },
          projectPath,
        );
        if (first.ok) return first;

        const lowerTexturePath = texturePath.trim().toLowerCase();
        const looksSvg = lowerTexturePath.endsWith('.svg');
        const detailsObj =
          first.details &&
          typeof first.details === 'object' &&
          !Array.isArray(first.details)
            ? (first.details as Record<string, unknown>)
            : {};
        const hintSuggestions = Array.isArray(detailsObj.suggestions)
          ? (detailsObj.suggestions as unknown[])
              .filter((s): s is string => typeof s === 'string')
              .map((s) => s.toLowerCase())
          : [];
        const hintedImport = hintSuggestions.some((s) => s.includes('import'));
        const logText = (first.logs ?? []).join('\n').toLowerCase();
        const mentionedNotImported =
          logText.includes('not imported') ||
          first.summary.toLowerCase().includes('not imported');

        if (!looksSvg || (!hintedImport && !mentionedNotImported)) return first;

        const godotPath = await ctx.ensureGodotPath();
        const importArgs = ['--headless', '--path', projectPath, '--import'];
        const importResult = await execGodot(godotPath, importArgs);
        const importLogs = [
          ...splitLines(importResult.stdout).map((l) => `[import] ${l}`),
          ...splitLines(importResult.stderr).map(
            (l) => `[import][stderr] ${l}`,
          ),
        ];
        if (importResult.exitCode !== 0) {
          return {
            ...first,
            details: {
              ...detailsObj,
              suggestions: [
                ...(Array.isArray(detailsObj.suggestions)
                  ? (detailsObj.suggestions as unknown[]).filter(
                      (s): s is string => typeof s === 'string',
                    )
                  : []),
                'Try running godot_import_project_assets, then retry godot_asset_manager(action="load_texture").',
              ],
              autoImportAttempted: true,
              importExitCode: importResult.exitCode,
            },
            logs: [...(first.logs ?? []), ...importLogs],
          };
        }

        const second = await runHeadlessOp(
          ctx,
          'load_sprite',
          { scenePath, nodePath, texturePath },
          projectPath,
        );
        return {
          ...second,
          details: {
            ...(second.details ?? {}),
            autoImportAttempted: true,
          },
          logs: [...importLogs, ...(second.logs ?? [])],
        };
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to load sprite: ${error instanceof Error ? error.message : String(error)}`,
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
  };
}
