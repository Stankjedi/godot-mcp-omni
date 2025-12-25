import fs from 'fs';
import path from 'path';
import { assertEditorRpcAllowed } from '../security.js';
import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNonNegativeInteger,
  asOptionalPositiveNumber,
  asOptionalRecord,
  asOptionalString,
  asRecord,
} from '../validation.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';

type BaseToolHandlers = Record<string, ToolHandler>;

function supportedActionError(
  toolName: string,
  action: string,
  supportedActions: string[],
): ToolResponse {
  return {
    ok: false,
    summary: `Unknown action: ${action}`,
    details: { tool: toolName, supportedActions },
  };
}

function hasEditorConnection(ctx: ServerContext): boolean {
  const client = ctx.getEditorClient();
  const projectPath = ctx.getEditorProjectPath();
  return Boolean(client && client.isConnected && projectPath);
}

function requireEditorConnected(toolName: string): ToolResponse {
  return {
    ok: false,
    summary: `${toolName} requires an editor bridge connection`,
    details: { suggestions: ['Call godot_workspace_manager(action="connect")'] },
  };
}

async function callBaseTool(
  baseHandlers: BaseToolHandlers,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const handler = baseHandlers[toolName];
  if (!handler) {
    return {
      ok: false,
      summary: `Internal error: missing handler for ${toolName}`,
      details: { toolName },
    };
  }
  return await handler(args);
}

function normalizeAction(value: string): string {
  return value.trim().toLowerCase();
}

function maybeGetString(
  argsObj: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): string | undefined {
  for (const key of keys) {
    const v = asOptionalString(argsObj[key], fieldName);
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function normalizeScreenName(input: string): string {
  const trimmed = input.trim();
  const lowered = trimmed.toLowerCase();
  if (lowered === '2d') return '2D';
  if (lowered === '3d') return '3D';
  if (lowered === 'script' || lowered === 'code') return 'Script';
  return trimmed;
}

export function createUnifiedToolHandlers(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): Record<string, ToolHandler> {
  return {
    godot_scene_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw);
      const timeoutMs = asOptionalPositiveNumber(argsObj.timeoutMs, 'timeoutMs');

      const supportedActions = [
        'create',
        'duplicate',
        'reparent',
        'instance',
        'remove',
        'undo',
        'redo',
      ];

      if (action === 'create') {
        const nodeType = maybeGetString(
          argsObj,
          ['nodeType', 'type', 'node_type'],
          'nodeType',
        );
        const nodeName = maybeGetString(
          argsObj,
          ['nodeName', 'name', 'node_name'],
          'nodeName',
        );
        if (!nodeType || !nodeName) {
          return {
            ok: false,
            summary: 'create requires nodeType and nodeName',
            details: {
              required: ['nodeType', 'nodeName'],
              suggestions: [
                'Example: godot_scene_manager(action="create", nodeType="Node2D", nodeName="Player", parentNodePath="root")',
              ],
            },
          };
        }

        const parentNodePath =
          maybeGetString(
            argsObj,
            ['parentNodePath', 'parentPath', 'parent_node_path', 'targetPath'],
            'parentNodePath',
          ) ?? 'root';

        const props =
          asOptionalRecord(argsObj.props, 'props') ??
          asOptionalRecord(argsObj.properties, 'properties');

        if (hasEditorConnection(ctx)) {
          const rpcParams: Record<string, unknown> = {
            parent_path: parentNodePath,
            type: nodeType,
            name: nodeName,
          };
          if (props) rpcParams.props = props;

          assertEditorRpcAllowed('add_node', rpcParams, ctx.getEditorProjectPath() ?? '');
          return await callBaseTool(baseHandlers, 'godot_rpc', {
            request_json: { method: 'add_node', params: rpcParams },
            ...(timeoutMs ? { timeoutMs } : {}),
          });
        }

        const projectPath = maybeGetString(
          argsObj,
          ['projectPath', 'project_path'],
          'projectPath',
        );
        const scenePath = maybeGetString(
          argsObj,
          ['scenePath', 'scene_path'],
          'scenePath',
        );
        if (!projectPath || !scenePath) {
          return {
            ok: false,
            summary:
              'Not connected to editor bridge; create requires projectPath and scenePath for headless mode',
            details: {
              required: ['projectPath', 'scenePath'],
              suggestions: [
                'Call godot_workspace_manager(action="connect") to create nodes in the currently edited scene.',
                'Or pass projectPath + scenePath to edit the scene file headlessly.',
              ],
            },
          };
        }

        return await callBaseTool(baseHandlers, 'add_node', {
          projectPath,
          scenePath,
          parentNodePath,
          nodeType,
          nodeName,
          ...(props ? { properties: props } : {}),
        });
      }

      if (action === 'duplicate') {
        if (!hasEditorConnection(ctx)) return requireEditorConnected('duplicate');
        const nodePath = maybeGetString(argsObj, ['nodePath', 'node_path'], 'nodePath');
        if (!nodePath) {
          return {
            ok: false,
            summary: 'duplicate requires nodePath',
            details: { required: ['nodePath'] },
          };
        }
        const newName = maybeGetString(argsObj, ['newName', 'new_name'], 'newName');
        return await callBaseTool(baseHandlers, 'godot_duplicate_node', {
          nodePath,
          ...(newName ? { newName } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      if (action === 'reparent') {
        if (!hasEditorConnection(ctx)) return requireEditorConnected('reparent');
        const nodePath = maybeGetString(argsObj, ['nodePath', 'node_path'], 'nodePath');
        const newParentPath = maybeGetString(
          argsObj,
          ['newParentPath', 'new_parent_path', 'targetPath', 'target_path'],
          'newParentPath',
        );
        if (!nodePath || !newParentPath) {
          return {
            ok: false,
            summary: 'reparent requires nodePath and newParentPath',
            details: { required: ['nodePath', 'newParentPath'] },
          };
        }
        const index = asOptionalNonNegativeInteger(argsObj.index, 'index');
        return await callBaseTool(baseHandlers, 'godot_reparent_node', {
          nodePath,
          newParentPath,
          ...(index === undefined ? {} : { index }),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      if (action === 'instance') {
        if (!hasEditorConnection(ctx)) return requireEditorConnected('instance');
        const scenePath = maybeGetString(argsObj, ['scenePath', 'scene_path'], 'scenePath');
        if (!scenePath) {
          return {
            ok: false,
            summary: 'instance requires scenePath',
            details: { required: ['scenePath'] },
          };
        }
        const parentNodePath =
          maybeGetString(
            argsObj,
            ['parentNodePath', 'parent_node_path', 'parentPath'],
            'parentNodePath',
          ) ?? 'root';
        const name = maybeGetString(argsObj, ['name'], 'name');
        const props = asOptionalRecord(argsObj.props, 'props');
        return await callBaseTool(baseHandlers, 'godot_add_scene_instance', {
          scenePath,
          parentNodePath,
          ...(name ? { name } : {}),
          ...(props ? { props } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      if (action === 'remove') {
        if (!hasEditorConnection(ctx)) return requireEditorConnected('remove');
        const nodePath = maybeGetString(argsObj, ['nodePath', 'node_path'], 'nodePath');
        if (!nodePath) {
          return {
            ok: false,
            summary: 'remove requires nodePath',
            details: { required: ['nodePath'] },
          };
        }
        const rpcParams: Record<string, unknown> = { node_path: nodePath };
        assertEditorRpcAllowed('remove_node', rpcParams, ctx.getEditorProjectPath() ?? '');
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'remove_node', params: rpcParams },
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      if (action === 'undo' || action === 'redo') {
        if (!hasEditorConnection(ctx)) return requireEditorConnected(action);
        const method = action === 'undo' ? 'undo_redo.undo' : 'undo_redo.redo';
        assertEditorRpcAllowed(method, {}, ctx.getEditorProjectPath() ?? '');
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method, params: {} },
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      return supportedActionError('godot_scene_manager', actionRaw, supportedActions);
    },

    godot_inspector_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw);
      const timeoutMs = asOptionalPositiveNumber(argsObj.timeoutMs, 'timeoutMs');

      const supportedActions = [
        'query',
        'inspect',
        'select',
        'connect_signal',
        'disconnect_signal',
        'property_list',
      ];

      if (action === 'query') {
        return await callBaseTool(baseHandlers, 'godot_scene_tree_query', {
          ...argsObj,
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      if (action === 'inspect') {
        const queryJsonRaw = argsObj.query_json ?? argsObj.queryJson ?? argsObj.query;
        if (queryJsonRaw !== undefined) {
          return await callBaseTool(baseHandlers, 'godot_inspect', {
            query_json: queryJsonRaw,
            ...(timeoutMs ? { timeoutMs } : {}),
          });
        }

        const className = maybeGetString(
          argsObj,
          ['className', 'class_name'],
          'className',
        );
        const nodePath = maybeGetString(argsObj, ['nodePath', 'node_path'], 'nodePath');
        const instanceId = argsObj.instanceId ?? argsObj.instance_id;

        const modeCount =
          Number(Boolean(className)) +
          Number(Boolean(nodePath)) +
          Number(instanceId !== undefined && instanceId !== null);
        if (modeCount !== 1) {
          return {
            ok: false,
            summary:
              'inspect requires exactly one of {className}, {nodePath}, {instanceId} (or provide query_json)',
          };
        }

        const query_json: Record<string, unknown> = {};
        if (className) query_json.class_name = className;
        else if (nodePath) query_json.node_path = nodePath;
        else query_json.instance_id = instanceId;

        return await callBaseTool(baseHandlers, 'godot_inspect', {
          query_json,
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      if (action === 'select') {
        return await callBaseTool(baseHandlers, 'godot_select_node', {
          ...argsObj,
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      if (action === 'disconnect_signal') {
        return await callBaseTool(baseHandlers, 'godot_disconnect_signal', {
          ...argsObj,
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      if (action === 'connect_signal') {
        const fromNodePath = maybeGetString(
          argsObj,
          ['fromNodePath', 'from_node_path'],
          'fromNodePath',
        );
        const toNodePath = maybeGetString(
          argsObj,
          ['toNodePath', 'to_node_path'],
          'toNodePath',
        );
        const signal = maybeGetString(argsObj, ['signal'], 'signal');
        const method = maybeGetString(argsObj, ['method'], 'method');
        if (!fromNodePath || !toNodePath || !signal || !method) {
          return {
            ok: false,
            summary:
              'connect_signal requires fromNodePath, signal, toNodePath, method',
            details: {
              required: ['fromNodePath', 'signal', 'toNodePath', 'method'],
            },
          };
        }

        if (hasEditorConnection(ctx)) {
          const rpcParams: Record<string, unknown> = {
            from_node_path: fromNodePath,
            to_node_path: toNodePath,
            signal,
            method,
          };
          assertEditorRpcAllowed(
            'connect_signal',
            rpcParams,
            ctx.getEditorProjectPath() ?? '',
          );
          return await callBaseTool(baseHandlers, 'godot_rpc', {
            request_json: { method: 'connect_signal', params: rpcParams },
            ...(timeoutMs ? { timeoutMs } : {}),
          });
        }

        const projectPath = maybeGetString(
          argsObj,
          ['projectPath', 'project_path'],
          'projectPath',
        );
        const scenePath = maybeGetString(
          argsObj,
          ['scenePath', 'scene_path'],
          'scenePath',
        );
        if (!projectPath || !scenePath) {
          return {
            ok: false,
            summary:
              'Not connected to editor bridge; connect_signal requires projectPath and scenePath for headless mode',
            details: {
              required: ['projectPath', 'scenePath'],
              suggestions: [
                'Call godot_workspace_manager(action="connect") to connect signals in the editor scene.',
                'Or pass projectPath + scenePath to connect signals headlessly (modifies the scene file).',
              ],
            },
          };
        }

        return await callBaseTool(baseHandlers, 'godot_headless_op', {
          projectPath,
          operation: 'connect_signal',
          params: {
            scenePath,
            fromNodePath,
            toNodePath,
            signal,
            method,
          },
        });
      }

      if (action === 'property_list') {
        const className = maybeGetString(
          argsObj,
          ['className', 'class_name'],
          'className',
        );
        const nodePath = maybeGetString(argsObj, ['nodePath', 'node_path'], 'nodePath');
        const instanceId = argsObj.instanceId ?? argsObj.instance_id;

        const modeCount =
          Number(Boolean(className)) +
          Number(Boolean(nodePath)) +
          Number(instanceId !== undefined && instanceId !== null);
        if (modeCount !== 1) {
          return {
            ok: false,
            summary:
              'property_list requires exactly one of {className}, {nodePath}, {instanceId}',
          };
        }

        const query_json: Record<string, unknown> = {};
        if (className) query_json.class_name = className;
        else if (nodePath) query_json.node_path = nodePath;
        else query_json.instance_id = instanceId;

        const inspect = await callBaseTool(baseHandlers, 'godot_inspect', {
          query_json,
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        if (!inspect.ok) return inspect;

        const result =
          inspect.details && typeof inspect.details === 'object'
            ? (inspect.details.result as unknown)
            : undefined;
        const props =
          result && typeof result === 'object' && !Array.isArray(result)
            ? (result as Record<string, unknown>).properties
            : undefined;

        return {
          ok: true,
          summary: 'property_list ok',
          details: { properties: props ?? [] },
        };
      }

      return supportedActionError(
        'godot_inspector_manager',
        actionRaw,
        supportedActions,
      );
    },

    godot_asset_manager: async (args: unknown): Promise<ToolResponse> => {
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
          assertEditorRpcAllowed('filesystem.scan', {}, ctx.getEditorProjectPath() ?? '');
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
          argsObj.files ?? argsObj.paths ?? argsObj.reimportFiles ?? argsObj.reimport_files;
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

          assertEditorRpcAllowed('filesystem.scan', {}, ctx.getEditorProjectPath() ?? '');
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

      return supportedActionError('godot_asset_manager', actionRaw, supportedActions);
    },

    godot_workspace_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw);

      const supportedActions = [
        'launch',
        'connect',
        'run',
        'stop',
        'open_scene',
        'save_all',
        'restart',
      ];

      if (action === 'launch') {
        return await callBaseTool(baseHandlers, 'launch_editor', { ...argsObj });
      }

      if (action === 'connect') {
        return await callBaseTool(baseHandlers, 'godot_connect_editor', {
          ...argsObj,
        });
      }

      if (action === 'open_scene') {
        if (!hasEditorConnection(ctx)) return requireEditorConnected('open_scene');
        const scenePath = maybeGetString(argsObj, ['scenePath', 'scene_path', 'path'], 'scenePath');
        if (!scenePath) {
          return {
            ok: false,
            summary: 'open_scene requires scenePath',
            details: { required: ['scenePath'] },
          };
        }
        const rpcParams: Record<string, unknown> = { path: scenePath };
        assertEditorRpcAllowed('open_scene', rpcParams, ctx.getEditorProjectPath() ?? '');
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'open_scene', params: rpcParams },
        });
      }

      if (action === 'save_all') {
        if (!hasEditorConnection(ctx)) return requireEditorConnected('save_all');
        assertEditorRpcAllowed('editor.save_all', {}, ctx.getEditorProjectPath() ?? '');
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'editor.save_all', params: {} },
        });
      }

      if (action === 'run') {
        const mode = maybeGetString(argsObj, ['mode', 'runMode'], 'mode') ?? 'auto';
        const wantsHeadless = mode.trim().toLowerCase() === 'headless';
        if (hasEditorConnection(ctx) && !wantsHeadless) {
          assertEditorRpcAllowed('editor.play_main', {}, ctx.getEditorProjectPath() ?? '');
          return await callBaseTool(baseHandlers, 'godot_rpc', {
            request_json: { method: 'editor.play_main', params: {} },
          });
        }
        return await callBaseTool(baseHandlers, 'run_project', { ...argsObj });
      }

      if (action === 'stop') {
        const mode = maybeGetString(argsObj, ['mode', 'runMode'], 'mode') ?? 'auto';
        const wantsHeadless = mode.trim().toLowerCase() === 'headless';
        if (hasEditorConnection(ctx) && !wantsHeadless) {
          assertEditorRpcAllowed('editor.stop', {}, ctx.getEditorProjectPath() ?? '');
          return await callBaseTool(baseHandlers, 'godot_rpc', {
            request_json: { method: 'editor.stop', params: {} },
          });
        }
        return await callBaseTool(baseHandlers, 'stop_project', { ...argsObj });
      }

      if (action === 'restart') {
        const mode = maybeGetString(argsObj, ['mode', 'runMode'], 'mode') ?? 'auto';
        const wantsHeadless = mode.trim().toLowerCase() === 'headless';
        if (hasEditorConnection(ctx) && !wantsHeadless) {
          assertEditorRpcAllowed('editor.restart', {}, ctx.getEditorProjectPath() ?? '');
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
        });
      }

      return supportedActionError(
        'godot_workspace_manager',
        actionRaw,
        supportedActions,
      );
    },

    godot_editor_view_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw);
      const timeoutMs = asOptionalPositiveNumber(argsObj.timeoutMs, 'timeoutMs');

      const supportedActions = [
        'capture_viewport',
        'switch_screen',
        'edit_script',
        'add_breakpoint',
      ];

      if (!hasEditorConnection(ctx)) return requireEditorConnected('godot_editor_view_manager');

      if (action === 'capture_viewport') {
        const maxSize = asOptionalPositiveNumber(argsObj.maxSize, 'maxSize');
        const rpcParams: Record<string, unknown> = {};
        if (maxSize !== undefined) rpcParams.max_size = maxSize;
        assertEditorRpcAllowed(
          'viewport.capture',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        const response = await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'viewport.capture', params: rpcParams },
          ...(timeoutMs ? { timeoutMs } : {}),
        });

        const savePath = maybeGetString(argsObj, ['savePath', 'save_path'], 'savePath');
        if (response.ok && savePath) {
          try {
            const result = (response.details?.result as any) || {};
            const b64 = result.base64;
            if (typeof b64 === 'string') {
              const buffer = Buffer.from(b64, 'base64');
              const fullPath = path.resolve(savePath);
              fs.writeFileSync(fullPath, buffer);
              response.summary = `Viewport captured and saved to: ${fullPath}`;
              if (response.details) {
                (response.details as any).saved_path = fullPath;
              }
            }
          } catch (error) {
            response.summary += ` (Failed to save file: ${String(error)})`;
          }
        }
        return response;
      }

      if (action === 'switch_screen') {
        const screenNameRaw = maybeGetString(
          argsObj,
          ['screenName', 'screen_name'],
          'screenName',
        );
        if (!screenNameRaw) {
          return {
            ok: false,
            summary: 'switch_screen requires screenName (2D/3D/Script)',
            details: { required: ['screenName'] },
          };
        }
        const screenName = normalizeScreenName(screenNameRaw);
        const rpcParams: Record<string, unknown> = { screen_name: screenName };
        assertEditorRpcAllowed(
          'viewport.set_screen',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'viewport.set_screen', params: rpcParams },
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      if (action === 'edit_script') {
        const scriptPath = maybeGetString(
          argsObj,
          ['scriptPath', 'script_path', 'path'],
          'scriptPath',
        );
        if (!scriptPath) {
          return {
            ok: false,
            summary: 'edit_script requires scriptPath',
            details: { required: ['scriptPath'] },
          };
        }
        const lineNumber =
          asOptionalNonNegativeInteger(argsObj.lineNumber, 'lineNumber') ??
          asOptionalNonNegativeInteger(argsObj.line, 'line');
        const rpcParams: Record<string, unknown> = { script_path: scriptPath };
        if (lineNumber !== undefined) rpcParams.line_number = lineNumber;
        assertEditorRpcAllowed(
          'script.edit',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'script.edit', params: rpcParams },
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      if (action === 'add_breakpoint') {
        const scriptPath = maybeGetString(
          argsObj,
          ['scriptPath', 'script_path', 'path'],
          'scriptPath',
        );
        const lineNumber =
          asOptionalNonNegativeInteger(argsObj.lineNumber, 'lineNumber') ??
          asOptionalNonNegativeInteger(argsObj.line, 'line');
        if (!scriptPath || lineNumber === undefined || lineNumber <= 0) {
          return {
            ok: false,
            summary: 'add_breakpoint requires scriptPath and lineNumber',
            details: { required: ['scriptPath', 'lineNumber'] },
          };
        }
        const rpcParams: Record<string, unknown> = {
          script_path: scriptPath,
          line_number: lineNumber,
        };
        assertEditorRpcAllowed(
          'script.add_breakpoint',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'script.add_breakpoint', params: rpcParams },
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      return supportedActionError(
        'godot_editor_view_manager',
        actionRaw,
        supportedActions,
      );
    },
  };
}
