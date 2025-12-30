import { assertEditorRpcAllowed } from '../../security.js';
import {
  asNonEmptyString,
  asOptionalPositiveNumber,
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

export function createInspectorManagerHandler(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): ToolHandler {
  return async (args: unknown): Promise<ToolResponse> => {
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
      const queryJsonRaw =
        argsObj.query_json ?? argsObj.queryJson ?? argsObj.query;
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
      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
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
      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
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
  };
}
