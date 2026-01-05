import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  assertDangerousOpsAllowed,
  assertEditorRpcAllowed,
  resolveInsideProject,
} from '../../security.js';
import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNonEmptyString,
  asOptionalNumber,
  asRecord,
} from '../../validation.js';

import type { ServerContext } from '../context.js';
import type { ToolHandler, ToolResponse } from '../types.js';

import {
  type BaseToolHandlers,
  callBaseTool,
  hasEditorConnection,
  maybeGetString,
  normalizeAction,
  supportedActionError,
} from './shared.js';

export function createAssetManagerHandler(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): ToolHandler {
  function toResPath(projectPath: string, absPath: string): string {
    const projectRootAbs = path.resolve(projectPath);
    const rel = path.relative(projectRootAbs, absPath);
    const normalized = rel.split(path.sep).join('/');
    return `res://${normalized}`;
  }

  async function listFilesRecursive(
    rootAbs: string,
    maxResults: number,
  ): Promise<string[]> {
    const out: string[] = [];
    const stack: string[] = [rootAbs];
    while (stack.length > 0 && out.length < maxResults) {
      const dir = stack.pop();
      if (!dir) break;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (out.length >= maxResults) break;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) stack.push(abs);
        else if (ent.isFile()) out.push(abs);
      }
    }
    return out;
  }

  return async (args: unknown): Promise<ToolResponse> => {
    const argsObj = asRecord(args, 'args');
    const actionRaw = asNonEmptyString(argsObj.action, 'action');
    const action = normalizeAction(actionRaw);

    const supportedActions = [
      'load_texture',
      'get_uid',
      'uid_convert',
      'scan',
      'reimport',
      'auto_import_check',
      'file_exists',
      'create_folder',
      'list_resources',
      'search_files',
      'scene.read',
      'scene.delete',
      'scene.duplicate',
      'scene.rename',
      'scene.replace_resource',
    ];

    if (action === 'load_texture') {
      return await callBaseTool(baseHandlers, 'load_sprite', { ...argsObj });
    }

    if (action === 'get_uid') {
      return await callBaseTool(baseHandlers, 'get_uid', { ...argsObj });
    }

    if (action === 'uid_convert') {
      return await callBaseTool(baseHandlers, 'get_uid', { ...argsObj });
    }

    if (action === 'file_exists') {
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);
      const filePath = asNonEmptyString(argsObj.filePath, 'filePath');
      const absPath = resolveInsideProject(projectPath, filePath);
      const exists = fs.existsSync(absPath);
      return {
        ok: true,
        summary: exists ? 'file_exists: true' : 'file_exists: false',
        details: {
          exists,
          filePath,
          absPath,
          resPath: filePath.startsWith('res://')
            ? filePath
            : toResPath(projectPath, absPath),
        },
      };
    }

    if (action === 'create_folder') {
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);
      const dirPath =
        asOptionalNonEmptyString(
          (argsObj as Record<string, unknown>).dirPath,
          'dirPath',
        ) ?? 'res://';

      const createParents =
        asOptionalBoolean(
          (argsObj as Record<string, unknown>).createParents,
          'createParents',
        ) ?? true;
      const absPath = resolveInsideProject(projectPath, dirPath);
      await fsp.mkdir(absPath, { recursive: createParents });
      return {
        ok: true,
        summary: 'create_folder ok',
        details: {
          dirPath,
          absPath,
          resPath: dirPath.startsWith('res://')
            ? dirPath
            : toResPath(projectPath, absPath),
        },
      };
    }

    if (action === 'list_resources') {
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);
      const dirPath =
        asOptionalNonEmptyString(
          (argsObj as Record<string, unknown>).dirPath,
          'dirPath',
        ) ?? 'res://';
      const recursive =
        asOptionalBoolean(
          (argsObj as Record<string, unknown>).recursive,
          'recursive',
        ) ?? false;
      const maxResults = Math.max(
        1,
        Math.min(
          5000,
          Math.floor(
            asOptionalNumber(
              (argsObj as Record<string, unknown>).maxResults,
              'maxResults',
            ) ?? 500,
          ),
        ),
      );

      const absRoot = resolveInsideProject(projectPath, dirPath);
      const absFiles = recursive
        ? await listFilesRecursive(absRoot, maxResults)
        : (await fsp.readdir(absRoot, { withFileTypes: true }))
            .filter((d) => d.isFile())
            .map((d) => path.join(absRoot, d.name))
            .slice(0, maxResults);

      const resPaths = absFiles.map((p) => toResPath(projectPath, p));

      return {
        ok: true,
        summary: `list_resources ok (${resPaths.length})`,
        details: {
          dirPath,
          recursive,
          count: resPaths.length,
          files: resPaths,
        },
      };
    }

    if (action === 'search_files') {
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);
      const pattern = asNonEmptyString(
        (argsObj as Record<string, unknown>).pattern,
        'pattern',
      );
      const dirPath =
        asOptionalNonEmptyString(
          (argsObj as Record<string, unknown>).dirPath,
          'dirPath',
        ) ?? 'res://';
      const recursive =
        asOptionalBoolean(
          (argsObj as Record<string, unknown>).recursive,
          'recursive',
        ) ?? true;
      const maxResults = Math.max(
        1,
        Math.min(
          5000,
          Math.floor(
            asOptionalNumber(
              (argsObj as Record<string, unknown>).maxResults,
              'maxResults',
            ) ?? 200,
          ),
        ),
      );

      const absRoot = resolveInsideProject(projectPath, dirPath);
      const absFiles = recursive
        ? await listFilesRecursive(absRoot, maxResults * 5)
        : (await fsp.readdir(absRoot, { withFileTypes: true }))
            .filter((d) => d.isFile())
            .map((d) => path.join(absRoot, d.name));

      const needle = pattern.toLowerCase();
      const matches: string[] = [];
      for (const abs of absFiles) {
        if (matches.length >= maxResults) break;
        const res = toResPath(projectPath, abs);
        if (res.toLowerCase().includes(needle)) matches.push(res);
      }

      return {
        ok: true,
        summary: `search_files ok (${matches.length})`,
        details: {
          pattern,
          dirPath,
          recursive,
          count: matches.length,
          files: matches,
        },
      };
    }

    if (action === 'scene.read') {
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);

      let scenePath =
        asOptionalNonEmptyString(
          (argsObj as Record<string, unknown>).scenePath,
          'scenePath',
        ) ?? null;

      if (!scenePath) {
        if (!hasEditorConnection(ctx)) {
          return {
            ok: false,
            summary:
              'scene.read requires scenePath when not connected to the editor bridge',
            details: {
              required: ['projectPath', 'scenePath'],
              suggestions: [
                'Pass scenePath explicitly, or call godot_workspace_manager(action="connect") to read the currently edited scene.',
              ],
            },
          };
        }

        const current = await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'get_current_scene', params: {} },
        });
        if (!current.ok) return current;

        const resultUnknown =
          current.details &&
          typeof current.details === 'object' &&
          !Array.isArray(current.details)
            ? (current.details as Record<string, unknown>).result
            : undefined;
        const result =
          resultUnknown &&
          typeof resultUnknown === 'object' &&
          !Array.isArray(resultUnknown)
            ? (resultUnknown as Record<string, unknown>)
            : null;
        const pathValue = result?.path;
        if (typeof pathValue !== 'string' || pathValue.trim().length === 0) {
          return {
            ok: false,
            summary: 'scene.read failed: current scene has no saved path',
            details: {
              suggestions: [
                'Save the scene first (godot_workspace_manager(action="save_scene") or save in editor), then retry.',
              ],
            },
          };
        }
        scenePath = pathValue.trim();
      }

      const absPath = resolveInsideProject(projectPath, scenePath);
      if (!fs.existsSync(absPath)) {
        return {
          ok: false,
          summary: 'scene.read: file not found',
          error: {
            code: 'E_NOT_FOUND',
            message: 'Scene file not found',
            details: { scenePath },
            retryable: true,
            suggestedFix: 'Verify scenePath and retry.',
          },
          details: { scenePath, absPath },
        };
      }

      const raw = await fsp.readFile(absPath, 'utf8');
      const maxChars = Math.max(
        200,
        Math.min(
          2_000_000,
          Math.floor(
            asOptionalNumber(
              (argsObj as Record<string, unknown>).maxChars,
              'maxChars',
            ) ?? 200_000,
          ),
        ),
      );
      const truncated = raw.length > maxChars;
      const content = truncated
        ? `${raw.slice(0, maxChars)}\n\n[TRUNCATED]`
        : raw;
      return {
        ok: true,
        summary: truncated ? 'scene.read ok (truncated)' : 'scene.read ok',
        details: {
          projectPath,
          scenePath,
          absolutePath: absPath,
          truncated,
          maxChars,
          content,
        },
      };
    }

    if (action === 'scene.delete') {
      assertDangerousOpsAllowed('asset_manager_scene_delete');

      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);
      const scenePath = asNonEmptyString(
        (argsObj as Record<string, unknown>).scenePath,
        'scenePath',
      );

      const absPath = resolveInsideProject(projectPath, scenePath);
      if (!fs.existsSync(absPath)) {
        return {
          ok: false,
          summary: 'scene.delete: file not found',
          error: {
            code: 'E_NOT_FOUND',
            message: 'Scene file not found',
            details: { scenePath },
            retryable: true,
            suggestedFix: 'Verify scenePath and retry.',
          },
          details: { scenePath, absPath },
        };
      }

      await fsp.unlink(absPath);
      if (hasEditorConnection(ctx)) {
        await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'filesystem.scan', params: {} },
        });
      }

      return {
        ok: true,
        summary: 'scene.delete ok',
        details: { projectPath, scenePath, absolutePath: absPath },
      };
    }

    if (action === 'scene.duplicate') {
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);

      const sourceScenePath = asNonEmptyString(
        (argsObj as Record<string, unknown>).sourceScenePath ??
          (argsObj as Record<string, unknown>).source_scene_path,
        'sourceScenePath',
      );
      const destScenePath = asNonEmptyString(
        (argsObj as Record<string, unknown>).destScenePath ??
          (argsObj as Record<string, unknown>).dest_scene_path,
        'destScenePath',
      );

      const absSource = resolveInsideProject(projectPath, sourceScenePath);
      const absDest = resolveInsideProject(projectPath, destScenePath);

      if (!fs.existsSync(absSource)) {
        return {
          ok: false,
          summary: 'scene.duplicate: source not found',
          error: {
            code: 'E_NOT_FOUND',
            message: 'Source scene not found',
            details: { sourceScenePath },
            retryable: true,
            suggestedFix: 'Verify sourceScenePath and retry.',
          },
          details: { sourceScenePath, absolutePath: absSource },
        };
      }

      const allowOverwrite = process.env.ALLOW_DANGEROUS_OPS === 'true';
      if (fs.existsSync(absDest) && !allowOverwrite) {
        return {
          ok: false,
          summary: 'scene.duplicate: destination exists',
          error: {
            code: 'E_PERMISSION_DENIED',
            message: 'Destination file already exists',
            details: { destScenePath },
            retryable: true,
            suggestedFix:
              'Choose a new destScenePath or set ALLOW_DANGEROUS_OPS=true to overwrite.',
          },
          details: { destScenePath, absolutePath: absDest },
        };
      }

      await fsp.mkdir(path.dirname(absDest), { recursive: true });
      await fsp.copyFile(absSource, absDest);

      if (hasEditorConnection(ctx)) {
        await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'filesystem.scan', params: {} },
        });
      }

      return {
        ok: true,
        summary: 'scene.duplicate ok',
        details: {
          projectPath,
          sourceScenePath,
          destScenePath,
          absoluteSourcePath: absSource,
          absoluteDestPath: absDest,
        },
      };
    }

    if (action === 'scene.rename') {
      assertDangerousOpsAllowed('asset_manager_scene_rename');

      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);
      const scenePath = asNonEmptyString(
        (argsObj as Record<string, unknown>).scenePath,
        'scenePath',
      );
      const newScenePath = asNonEmptyString(
        (argsObj as Record<string, unknown>).newScenePath ??
          (argsObj as Record<string, unknown>).new_scene_path,
        'newScenePath',
      );

      const absSource = resolveInsideProject(projectPath, scenePath);
      const absDest = resolveInsideProject(projectPath, newScenePath);

      if (!fs.existsSync(absSource)) {
        return {
          ok: false,
          summary: 'scene.rename: source not found',
          error: {
            code: 'E_NOT_FOUND',
            message: 'Scene file not found',
            details: { scenePath },
            retryable: true,
            suggestedFix: 'Verify scenePath and retry.',
          },
          details: { scenePath, absolutePath: absSource },
        };
      }

      const allowOverwrite = process.env.ALLOW_DANGEROUS_OPS === 'true';
      if (fs.existsSync(absDest) && !allowOverwrite) {
        return {
          ok: false,
          summary: 'scene.rename: destination exists',
          error: {
            code: 'E_PERMISSION_DENIED',
            message: 'Destination file already exists',
            details: { newScenePath },
            retryable: true,
            suggestedFix:
              'Choose a newScenePath or set ALLOW_DANGEROUS_OPS=true to overwrite.',
          },
          details: { newScenePath, absolutePath: absDest },
        };
      }

      await fsp.mkdir(path.dirname(absDest), { recursive: true });
      await fsp.rename(absSource, absDest);

      if (hasEditorConnection(ctx)) {
        await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'filesystem.scan', params: {} },
        });
      }

      return {
        ok: true,
        summary: 'scene.rename ok',
        details: {
          projectPath,
          scenePath,
          newScenePath,
          absoluteSourcePath: absSource,
          absoluteDestPath: absDest,
        },
      };
    }

    if (action === 'scene.replace_resource') {
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);
      const scenePath = asNonEmptyString(
        (argsObj as Record<string, unknown>).scenePath,
        'scenePath',
      );
      const oldResource = asNonEmptyString(
        (argsObj as Record<string, unknown>).oldResource,
        'oldResource',
      );
      const newResource = asNonEmptyString(
        (argsObj as Record<string, unknown>).newResource,
        'newResource',
      );

      const absPath = resolveInsideProject(projectPath, scenePath);
      if (!fs.existsSync(absPath)) {
        return {
          ok: false,
          summary: 'scene.replace_resource: file not found',
          error: {
            code: 'E_NOT_FOUND',
            message: 'Scene file not found',
            details: { scenePath },
            retryable: true,
            suggestedFix: 'Verify scenePath and retry.',
          },
          details: { scenePath, absPath },
        };
      }

      const raw = await fsp.readFile(absPath, 'utf8');
      const count = raw.split(oldResource).length - 1;
      if (count <= 0) {
        return {
          ok: false,
          summary: 'scene.replace_resource: oldResource not found',
          details: { scenePath, oldResource, newResource, count: 0 },
        };
      }

      const next = raw.split(oldResource).join(newResource);
      await fsp.writeFile(absPath, next, 'utf8');

      if (hasEditorConnection(ctx)) {
        await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'filesystem.scan', params: {} },
        });
      }

      return {
        ok: true,
        summary: 'scene.replace_resource ok',
        details: { projectPath, scenePath, oldResource, newResource, count },
      };
    }

    if (action === 'scan') {
      if (hasEditorConnection(ctx)) {
        assertEditorRpcAllowed(
          'filesystem.scan',
          {},
          ctx.getEditorProjectPath() ?? '',
        );
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'filesystem.scan', params: {} },
        });
      }
      const projectPath = maybeGetString(
        argsObj,
        ['projectPath', 'project_path'],
        'projectPath',
      );
      if (!projectPath) {
        return {
          ok: false,
          summary:
            'Not connected to editor bridge; scan requires projectPath to run a headless import fallback',
          details: {
            required: ['projectPath'],
            suggestions: [
              'Call godot_workspace_manager(action="connect") to run filesystem.scan in-editor.',
            ],
          },
        };
      }
      return await callBaseTool(baseHandlers, 'godot_import_project_assets', {
        projectPath,
      });
    }

    if (action === 'reimport') {
      const filesValue =
        argsObj.files ??
        argsObj.paths ??
        argsObj.reimportFiles ??
        argsObj.reimport_files;
      const files: string[] = Array.isArray(filesValue)
        ? filesValue.filter((v): v is string => typeof v === 'string')
        : [];

      if (hasEditorConnection(ctx)) {
        const rpcParams: Record<string, unknown> = { files };
        assertEditorRpcAllowed(
          'filesystem.reimport_files',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: {
            method: 'filesystem.reimport_files',
            params: rpcParams,
          },
        });
      }

      const projectPath = maybeGetString(
        argsObj,
        ['projectPath', 'project_path'],
        'projectPath',
      );
      if (!projectPath) {
        return {
          ok: false,
          summary:
            'Not connected to editor bridge; reimport requires projectPath to run a headless import fallback',
          details: {
            required: ['projectPath'],
            suggestions: [
              'Call godot_workspace_manager(action="connect") to reimport specific files via the editor.',
            ],
          },
        };
      }

      return await callBaseTool(baseHandlers, 'godot_import_project_assets', {
        projectPath,
      });
    }

    if (action === 'auto_import_check') {
      const forceReimport =
        asOptionalBoolean(argsObj.forceReimport, 'forceReimport') ?? false;
      const filesValue = argsObj.files ?? argsObj.paths;
      const files: string[] = Array.isArray(filesValue)
        ? filesValue.filter((v): v is string => typeof v === 'string')
        : [];

      if (hasEditorConnection(ctx)) {
        if (forceReimport && files.length > 0) {
          const rpcParams: Record<string, unknown> = { files };
          assertEditorRpcAllowed(
            'filesystem.reimport_files',
            rpcParams,
            ctx.getEditorProjectPath() ?? '',
          );
          return await callBaseTool(baseHandlers, 'godot_rpc', {
            request_json: {
              method: 'filesystem.reimport_files',
              params: rpcParams,
            },
          });
        }

        assertEditorRpcAllowed(
          'filesystem.scan',
          {},
          ctx.getEditorProjectPath() ?? '',
        );
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'filesystem.scan', params: {} },
        });
      }

      const projectPath = maybeGetString(
        argsObj,
        ['projectPath', 'project_path'],
        'projectPath',
      );
      if (!projectPath) {
        return {
          ok: false,
          summary:
            'Not connected to editor bridge; auto_import_check requires projectPath',
          details: { required: ['projectPath'] },
        };
      }
      return await callBaseTool(baseHandlers, 'godot_import_project_assets', {
        projectPath,
      });
    }

    return supportedActionError(
      'godot_asset_manager',
      actionRaw,
      supportedActions,
    );
  };
}
