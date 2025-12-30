import { assertEditorRpcAllowed } from '../../security.js';
import {
  asNonEmptyString,
  asOptionalBoolean,
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
  return async (args: unknown): Promise<ToolResponse> => {
    const argsObj = asRecord(args, 'args');
    const actionRaw = asNonEmptyString(argsObj.action, 'action');
    const action = normalizeAction(actionRaw);

    const supportedActions = [
      'load_texture',
      'get_uid',
      'scan',
      'reimport',
      'auto_import_check',
    ];

    if (action === 'load_texture') {
      return await callBaseTool(baseHandlers, 'load_sprite', { ...argsObj });
    }

    if (action === 'get_uid') {
      return await callBaseTool(baseHandlers, 'get_uid', { ...argsObj });
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
