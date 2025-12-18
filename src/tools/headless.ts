import path from 'path';
import { existsSync } from 'fs';

import { executeHeadlessOperation } from '../headless_ops.js';
import { execGodot } from '../godot_cli.js';
import { resolveInsideProject } from '../security.js';
import { assertDangerousOpsAllowed } from '../security.js';
import { asNonEmptyString, asOptionalRecordOrJson } from '../validation.js';

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
  projectPath: string
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

  if (op === 'save_scene') validate(getString('newPath') ?? getString('new_path'));
  if (op === 'get_uid') validate(getString('filePath') ?? getString('file_path'));

  if (op === 'attach_script') {
    validate(getString('scenePath') ?? getString('scene_path'));
    validate(getString('scriptPath') ?? getString('script_path'));
  }

  if (op === 'create_script') validate(getString('scriptPath') ?? getString('script_path'));

  if (op === 'read_text_file' || op === 'write_text_file') validate(getString('path'));
  if (op === 'create_resource') validate(getString('resourcePath') ?? getString('resource_path'));
}

async function runHeadlessOp(
  ctx: ServerContext,
  operation: string,
  params: Record<string, unknown>,
  projectPath: string
): Promise<ToolResponse> {
  ctx.assertValidProject(projectPath);
  assertDangerousOpsAllowed(operation);
  validateHeadlessOpPaths(operation, params, projectPath);

  const godotPath = await ctx.ensureGodotPath();
  const snakeParams = ctx.convertCamelToSnakeCase(params) as Record<string, unknown>;

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
      logs: (Array.isArray(result.parsed.logs) ? result.parsed.logs : undefined) ?? logs,
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

export function createHeadlessToolHandlers(ctx: ServerContext): Record<string, ToolHandler> {
  return {
    godot_headless_op: async (args: any): Promise<ToolResponse> => {
      const projectPath = asNonEmptyString(args.projectPath, 'projectPath');
      const operation = asNonEmptyString(args.operation, 'operation');
      const params = asOptionalRecordOrJson(args.params, 'params', {});
      return await runHeadlessOp(ctx, operation, params, projectPath);
    },

    create_scene: async (args: any): Promise<ToolResponse> => {
      if (!args.projectPath || !args.scenePath) {
        return { ok: false, summary: 'projectPath and scenePath are required' };
      }

      try {
        const absScene = resolveInsideProject(args.projectPath, args.scenePath);
        const res = await runHeadlessOp(
          ctx,
          'create_scene',
          { scenePath: args.scenePath, rootNodeType: args.rootNodeType ?? 'Node2D' },
          args.projectPath
        );
        if (!res.ok) {
          res.details = {
            ...(res.details ?? {}),
            suggestions: ['Check if rootNodeType is valid', `Target file: ${absScene}`],
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

    add_node: async (args: any): Promise<ToolResponse> => {
      if (!args.projectPath || !args.scenePath || !args.nodeType || !args.nodeName) {
        return {
          ok: false,
          summary: 'projectPath, scenePath, nodeType, nodeName are required',
        };
      }

      try {
        const absScene = resolveInsideProject(args.projectPath, args.scenePath);
        if (!existsSync(absScene)) {
          return {
            ok: false,
            summary: `Scene file does not exist: ${args.scenePath}`,
            details: {
              suggestions: ['Run create_scene first', `Expected path: ${absScene}`],
            },
          };
        }

        const params: Record<string, unknown> = {
          scenePath: args.scenePath,
          parentNodePath: args.parentNodePath ?? 'root',
          nodeType: args.nodeType,
          nodeName: args.nodeName,
        };
        if (args.properties) params.properties = args.properties;

        return await runHeadlessOp(ctx, 'add_node', params, args.projectPath);
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to add node: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    load_sprite: async (args: any): Promise<ToolResponse> => {
      if (!args.projectPath || !args.scenePath || !args.nodePath || !args.texturePath) {
        return {
          ok: false,
          summary: 'projectPath, scenePath, nodePath, texturePath are required',
        };
      }

      try {
        return await runHeadlessOp(
          ctx,
          'load_sprite',
          { scenePath: args.scenePath, nodePath: args.nodePath, texturePath: args.texturePath },
          args.projectPath
        );
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to load sprite: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    export_mesh_library: async (args: any): Promise<ToolResponse> => {
      if (!args.projectPath || !args.scenePath || !args.outputPath) {
        return { ok: false, summary: 'projectPath, scenePath, outputPath are required' };
      }

      try {
        const params: Record<string, unknown> = { scenePath: args.scenePath, outputPath: args.outputPath };
        if (args.meshItemNames) params.meshItemNames = args.meshItemNames;
        return await runHeadlessOp(ctx, 'export_mesh_library', params, args.projectPath);
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to export mesh library: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    save_scene: async (args: any): Promise<ToolResponse> => {
      if (!args.projectPath || !args.scenePath) {
        return { ok: false, summary: 'projectPath and scenePath are required' };
      }

      try {
        const params: Record<string, unknown> = { scenePath: args.scenePath };
        if (args.newPath) params.newPath = args.newPath;
        return await runHeadlessOp(ctx, 'save_scene', params, args.projectPath);
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to save scene: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    get_uid: async (args: any): Promise<ToolResponse> => {
      if (!args.projectPath || !args.filePath) {
        return { ok: false, summary: 'projectPath and filePath are required' };
      }

      try {
        ctx.assertValidProject(args.projectPath);
        resolveInsideProject(args.projectPath, args.filePath);

        const godotPath = await ctx.ensureGodotPath();
        const { stdout: versionStdout } = await execGodot(godotPath, ['--version']);
        const version = versionStdout.trim();
        if (!isGodot44OrLater(version)) {
          return { ok: false, summary: `UIDs require Godot 4.4+. Current: ${version}` };
        }

        return await runHeadlessOp(ctx, 'get_uid', { filePath: args.filePath }, args.projectPath);
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to get UID: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    update_project_uids: async (args: any): Promise<ToolResponse> => {
      if (!args.projectPath) return { ok: false, summary: 'projectPath is required' };

      try {
        ctx.assertValidProject(args.projectPath);

        const godotPath = await ctx.ensureGodotPath();
        const { stdout: versionStdout } = await execGodot(godotPath, ['--version']);
        const version = versionStdout.trim();
        if (!isGodot44OrLater(version)) {
          return { ok: false, summary: `UIDs require Godot 4.4+. Current: ${version}` };
        }

        return await runHeadlessOp(
          ctx,
          'resave_resources',
          { projectPath: args.projectPath },
          args.projectPath
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

