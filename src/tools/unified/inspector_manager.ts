import { assertEditorRpcAllowed } from '../../security.js';
import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNumber,
  asOptionalRecord,
  asOptionalPositiveNumber,
  asOptionalString,
  asRecord,
  asPositiveNumber,
  ValidationError,
  valueType,
} from '../../validation.js';

import type { ServerContext } from '../context.js';
import type { ToolHandler, ToolResponse } from '../types.js';

import {
  type BaseToolHandlers,
  callBaseTool,
  hasEditorConnection,
  maybeGetString,
  normalizeAction,
  requireEditorConnected,
  supportedActionError,
} from './shared.js';
import { resolveCollisionMask } from './scene_manager/parsing.js';

function asInstanceId(value: unknown, fieldName: string): number | string {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ValidationError(
        fieldName,
        `Invalid field "${fieldName}": expected positive integer`,
        valueType(value),
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new ValidationError(
        fieldName,
        `Invalid field "${fieldName}": number is not a safe integer; pass instanceId as a string instead`,
        valueType(value),
      );
    }
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^[0-9]+$/u.test(trimmed) || trimmed === '0') {
      throw new ValidationError(
        fieldName,
        `Invalid field "${fieldName}": expected integer string`,
        valueType(value),
      );
    }
    return trimmed;
  }
  throw new ValidationError(
    fieldName,
    `Invalid field "${fieldName}": expected integer or integer string`,
    valueType(value),
  );
}

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
      'scene_tree.get',
      'inspect',
      'select',
      'connect_signal',
      'disconnect_signal',
      'property_list',
      'resource.add',
      'set_property',
      'get_property',
      'get_selection',
      'method_list',
      'signals.list',
      'signals.connections.list',
      'groups.get',
      'groups.add',
      'groups.remove',
      'animation.list',
      'animation.play',
      'animation.stop',
      'animation.seek',
      'animation.create_simple',
      'audio.play',
      'audio.stop',
      'audio.set_bus_volume',
      'focus_node',
      'shader.set_param',
      'set_collision_layer',
    ];

    if (action === 'query') {
      if (!hasEditorConnection(ctx)) return requireEditorConnected('query');

      const name = asOptionalString(argsObj.name, 'name')?.trim();
      const nameContains = asOptionalString(
        (argsObj as Record<string, unknown>).nameContains,
        'nameContains',
      )?.trim();
      const className = asOptionalString(
        (argsObj as Record<string, unknown>).className,
        'className',
      )?.trim();
      const group = asOptionalString(argsObj.group, 'group')?.trim();
      const includeRoot =
        asOptionalBoolean(
          (argsObj as Record<string, unknown>).includeRoot,
          'includeRoot',
        ) ?? false;
      const limitRaw = (argsObj as Record<string, unknown>).limit;
      const limit =
        limitRaw === undefined || limitRaw === null
          ? undefined
          : asPositiveNumber(limitRaw, 'limit');

      const rpcParams: Record<string, unknown> = {
        include_root: includeRoot,
      };
      if (name) rpcParams.name = name;
      if (nameContains) rpcParams.name_contains = nameContains;
      if (className) rpcParams.class_name = className;
      if (group) rpcParams.group = group;
      if (limit !== undefined) rpcParams.limit = limit;

      assertEditorRpcAllowed(
        'scene_tree.query',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      return await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'scene_tree.query', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
    }

    if (action === 'scene_tree.get') {
      if (!hasEditorConnection(ctx))
        return requireEditorConnected('scene_tree.get');

      const limitRaw = (argsObj as Record<string, unknown>).limit;
      const limit =
        limitRaw === undefined || limitRaw === null
          ? 5000
          : Math.max(1, Math.min(50_000, asPositiveNumber(limitRaw, 'limit')));

      const rpcParams: Record<string, unknown> = {
        include_root: true,
        limit,
      };

      assertEditorRpcAllowed(
        'scene_tree.query',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'scene_tree.query', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      if (!resp.ok) return resp;

      const resultUnknown =
        resp.details &&
        typeof resp.details === 'object' &&
        !Array.isArray(resp.details)
          ? (resp.details as Record<string, unknown>).result
          : undefined;
      const result =
        resultUnknown &&
        typeof resultUnknown === 'object' &&
        !Array.isArray(resultUnknown)
          ? (resultUnknown as Record<string, unknown>)
          : null;

      const nodesUnknown = result?.nodes;
      const nodesRaw = Array.isArray(nodesUnknown)
        ? nodesUnknown
            .filter((n): n is Record<string, unknown> =>
              Boolean(n && typeof n === 'object' && !Array.isArray(n)),
            )
            .slice(0, limit)
        : [];

      type TreeNode = {
        node_path: string;
        name: string;
        class: string;
        instance_id: number | string | null;
        children: TreeNode[];
      };

      const byPath = new Map<string, TreeNode>();

      for (const n of nodesRaw) {
        const nodePath = typeof n.node_path === 'string' ? n.node_path : null;
        if (!nodePath) continue;
        byPath.set(nodePath, {
          node_path: nodePath,
          name:
            typeof n.name === 'string'
              ? n.name
              : (nodePath.split('/').slice(-1)[0] ?? nodePath),
          class: typeof n.class === 'string' ? n.class : 'Node',
          instance_id:
            typeof n.instance_id === 'number' ||
            typeof n.instance_id === 'string'
              ? n.instance_id
              : typeof n.instance_id_str === 'string'
                ? n.instance_id_str
                : null,
          children: [],
        });
      }

      const ensureNode = (nodePath: string): TreeNode => {
        const existing = byPath.get(nodePath);
        if (existing) return existing;
        const placeholder: TreeNode = {
          node_path: nodePath,
          name:
            nodePath === 'root'
              ? 'root'
              : (nodePath.split('/').slice(-1)[0] ?? nodePath),
          class: 'Node',
          instance_id: null,
          children: [],
        };
        byPath.set(nodePath, placeholder);
        return placeholder;
      };

      const root = ensureNode('root');

      const paths = Array.from(byPath.keys()).sort((a, b) => {
        if (a === 'root') return -1;
        if (b === 'root') return 1;
        return a.split('/').length - b.split('/').length;
      });

      for (const nodePath of paths) {
        if (nodePath === 'root') continue;
        const node = ensureNode(nodePath);
        const parentPath = nodePath.includes('/')
          ? nodePath.split('/').slice(0, -1).join('/')
          : 'root';
        const parent = ensureNode(parentPath);
        parent.children.push(node);
      }

      return {
        ok: true,
        summary: 'scene_tree.get ok',
        details: {
          limit,
          count: nodesRaw.length,
          tree: root,
        },
      };
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
      if (!hasEditorConnection(ctx)) return requireEditorConnected('select');

      const clear =
        asOptionalBoolean(
          (argsObj as Record<string, unknown>).clear,
          'clear',
        ) ?? false;
      const additive =
        asOptionalBoolean(
          (argsObj as Record<string, unknown>).additive,
          'additive',
        ) ?? false;

      if (clear) {
        assertEditorRpcAllowed(
          'selection.clear',
          {},
          ctx.getEditorProjectPath() ?? '',
        );
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'selection.clear', params: {} },
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      }

      const nodePathRaw = asOptionalString(argsObj.nodePath, 'nodePath');
      const nodePath =
        nodePathRaw && nodePathRaw.trim().length > 0
          ? nodePathRaw.trim()
          : undefined;
      const instanceIdRaw = argsObj.instanceId ?? argsObj.instance_id;
      const instanceId =
        instanceIdRaw === undefined || instanceIdRaw === null
          ? undefined
          : asInstanceId(instanceIdRaw, 'instanceId');

      if (!nodePath && instanceId === undefined) {
        return {
          ok: false,
          summary: 'select requires nodePath or instanceId (or set clear=true)',
          error: {
            code: 'E_SCHEMA_VALIDATION',
            message:
              'select requires nodePath or instanceId (or set clear=true)',
            details: { required: ['nodePath | instanceId | clear=true'] },
            retryable: true,
            suggestedFix: 'Provide nodePath or instanceId (or set clear=true).',
          },
          details: { required: ['nodePath | instanceId | clear=true'] },
        };
      }

      const rpcParams: Record<string, unknown> = { additive };
      if (nodePath) rpcParams.node_path = nodePath;
      if (instanceId !== undefined) rpcParams.instance_id = instanceId;

      assertEditorRpcAllowed(
        'selection.select_node',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      return await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'selection.select_node', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
    }

    if (action === 'disconnect_signal') {
      if (!hasEditorConnection(ctx))
        return requireEditorConnected('disconnect_signal');

      const fromNodePath = asNonEmptyString(
        argsObj.fromNodePath,
        'fromNodePath',
      );
      const signal = asNonEmptyString(argsObj.signal, 'signal');
      const toNodePath = asNonEmptyString(argsObj.toNodePath, 'toNodePath');
      const method = asNonEmptyString(argsObj.method, 'method');

      const rpcParams: Record<string, unknown> = {
        from_node_path: fromNodePath,
        signal,
        to_node_path: toNodePath,
        method,
      };

      assertEditorRpcAllowed(
        'disconnect_signal',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      return await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'disconnect_signal', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
    }

    if (action === 'resource.add') {
      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
      const property = maybeGetString(argsObj, ['property'], 'property');
      const resourceType = maybeGetString(
        argsObj,
        ['resourceType', 'resource_type', 'resource', 'type', '$resource'],
        'resourceType',
      );
      const resourcePath = maybeGetString(
        argsObj,
        ['resourcePath', 'resource_path', 'path'],
        'resourcePath',
      );
      const props =
        asOptionalRecord((argsObj as Record<string, unknown>).props, 'props') ??
        asOptionalRecord(
          (argsObj as Record<string, unknown>).properties,
          'properties',
        );

      if (!nodePath || !property || !resourceType) {
        return {
          ok: false,
          summary: 'resource.add requires nodePath, property, resourceType',
          error: {
            code: 'E_SCHEMA_VALIDATION',
            message: 'resource.add requires nodePath, property, resourceType',
            details: { required: ['nodePath', 'property', 'resourceType'] },
            retryable: true,
            suggestedFix: 'Provide nodePath, property, and resourceType.',
          },
          details: { required: ['nodePath', 'property', 'resourceType'] },
        };
      }

      const value: Record<string, unknown> = {
        $resource: resourceType,
        ...(resourcePath ? { path: resourcePath } : {}),
        ...(props ? { props } : {}),
      };

      if (hasEditorConnection(ctx)) {
        const steps = [
          {
            method: 'set_property',
            params: { node_path: nodePath, property, value },
          },
        ];
        return await callBaseTool(baseHandlers, 'godot_editor_batch', {
          actionName: 'godot_inspector_manager:resource.add',
          steps,
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
            'Not connected to editor bridge; resource.add requires projectPath and scenePath for headless mode',
          error: {
            code: 'E_NOT_CONNECTED',
            message:
              'Not connected to editor bridge; resource.add requires projectPath and scenePath for headless mode',
            details: { required: ['projectPath', 'scenePath'] },
            retryable: true,
            suggestedFix:
              'Call godot_workspace_manager(action="connect") or pass projectPath + scenePath.',
          },
          details: { required: ['projectPath', 'scenePath'] },
        };
      }

      return await callBaseTool(baseHandlers, 'godot_headless_op', {
        projectPath,
        operation: 'set_node_properties',
        params: { scenePath, nodePath, props: { [property]: value } },
      });
    }

    if (action === 'set_property') {
      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
      const property = maybeGetString(argsObj, ['property'], 'property');
      const hasValue = Object.prototype.hasOwnProperty.call(argsObj, 'value');
      const value = hasValue
        ? (argsObj as Record<string, unknown>).value
        : undefined;
      if (!nodePath || !property || !hasValue) {
        return {
          ok: false,
          summary: 'set_property requires nodePath and property',
          error: {
            code: 'E_SCHEMA_VALIDATION',
            message: 'set_property requires nodePath and property',
            details: { required: ['nodePath', 'property', 'value'] },
            retryable: true,
            suggestedFix: 'Provide nodePath, property, and value.',
          },
          details: { required: ['nodePath', 'property', 'value'] },
        };
      }

      if (hasEditorConnection(ctx)) {
        const steps = [
          {
            method: 'set_property',
            params: { node_path: nodePath, property, value },
          },
        ];
        return await callBaseTool(baseHandlers, 'godot_editor_batch', {
          actionName: 'godot_inspector_manager:set_property',
          steps,
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
            'Not connected to editor bridge; set_property requires projectPath and scenePath for headless mode',
          error: {
            code: 'E_NOT_CONNECTED',
            message:
              'Not connected to editor bridge; set_property requires projectPath and scenePath for headless mode',
            details: { required: ['projectPath', 'scenePath'] },
            retryable: true,
            suggestedFix:
              'Call godot_workspace_manager(action="connect") or pass projectPath + scenePath.',
          },
          details: { required: ['projectPath', 'scenePath'] },
        };
      }

      return await callBaseTool(baseHandlers, 'godot_headless_op', {
        projectPath,
        operation: 'set_node_properties',
        params: { scenePath, nodePath, props: { [property]: value } },
      });
    }

    if (action === 'get_property') {
      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
      const property = maybeGetString(argsObj, ['property'], 'property');
      if (!nodePath || !property) {
        return {
          ok: false,
          summary: 'get_property requires nodePath and property',
          error: {
            code: 'E_SCHEMA_VALIDATION',
            message: 'get_property requires nodePath and property',
            details: { required: ['nodePath', 'property'] },
            retryable: true,
            suggestedFix: 'Provide nodePath and property.',
          },
          details: { required: ['nodePath', 'property'] },
        };
      }

      if (!hasEditorConnection(ctx)) {
        return {
          ok: false,
          summary: 'get_property requires an editor bridge connection',
          error: {
            code: 'E_NOT_CONNECTED',
            message: 'get_property requires an editor bridge connection',
            details: {
              suggestions: ['Call godot_workspace_manager(action="connect")'],
            },
            retryable: true,
            suggestedFix:
              'Call godot_workspace_manager(action="connect") and retry.',
          },
          details: {
            suggestions: ['Call godot_workspace_manager(action="connect")'],
          },
        };
      }

      const rpcParams: Record<string, unknown> = {
        node_path: nodePath,
        property,
      };
      assertEditorRpcAllowed(
        'get_property',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      return await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'get_property', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
    }

    if (action === 'get_selection') {
      if (!hasEditorConnection(ctx)) {
        return {
          ok: false,
          summary: 'get_selection requires an editor bridge connection',
          error: {
            code: 'E_NOT_CONNECTED',
            message: 'get_selection requires an editor bridge connection',
            details: {
              suggestions: ['Call godot_workspace_manager(action="connect")'],
            },
            retryable: true,
            suggestedFix:
              'Call godot_workspace_manager(action="connect") and retry.',
          },
          details: {
            suggestions: ['Call godot_workspace_manager(action="connect")'],
          },
        };
      }

      assertEditorRpcAllowed(
        'selection.get',
        {},
        ctx.getEditorProjectPath() ?? '',
      );
      return await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'selection.get', params: {} },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
    }

    if (action === 'method_list') {
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
            'method_list requires exactly one of {className}, {nodePath}, {instanceId}',
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
      const methods =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as Record<string, unknown>).methods
          : undefined;

      return {
        ok: true,
        summary: 'method_list ok',
        details: { methods: methods ?? [] },
      };
    }

    if (action === 'signals.list') {
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
            'signals.list requires exactly one of {className}, {nodePath}, {instanceId}',
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
      const signals =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as Record<string, unknown>).signals
          : undefined;

      return {
        ok: true,
        summary: 'signals.list ok',
        details: { signals: signals ?? [] },
      };
    }

    if (action === 'signals.connections.list') {
      if (!hasEditorConnection(ctx))
        return requireEditorConnected('signals.connections.list');

      const sourceNodePath = maybeGetString(
        argsObj,
        [
          'sourceNodePath',
          'source_node_path',
          'source',
          'nodePath',
          'node_path',
        ],
        'sourceNodePath',
      );
      if (!sourceNodePath) {
        return {
          ok: false,
          summary: 'signals.connections.list requires sourceNodePath',
          details: { required: ['sourceNodePath'] },
        };
      }

      const signal = asOptionalString(argsObj.signal, 'signal')?.trim();

      const rpcParams: Record<string, unknown> = {
        source: sourceNodePath,
        ...(signal ? { signal } : {}),
      };
      const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'list_signal_connections', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      return {
        ok: resp.ok,
        summary: resp.ok
          ? 'signals.connections.list ok'
          : 'signals.connections.list failed',
        details: { response: resp },
        logs: resp.logs,
      };
    }

    if (
      action === 'groups.get' ||
      action === 'groups.add' ||
      action === 'groups.remove'
    ) {
      if (!hasEditorConnection(ctx)) return requireEditorConnected(action);

      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
      if (!nodePath) {
        return {
          ok: false,
          summary: `${action} requires nodePath`,
          details: { required: ['nodePath'] },
        };
      }

      const groupName = asOptionalString(
        (argsObj as Record<string, unknown>).groupName,
        'groupName',
      )?.trim();

      if (
        (action === 'groups.add' || action === 'groups.remove') &&
        !groupName
      ) {
        return {
          ok: false,
          summary: `${action} requires groupName`,
          details: { required: ['nodePath', 'groupName'] },
        };
      }

      const method =
        action === 'groups.get'
          ? 'get_groups'
          : action === 'groups.add'
            ? 'add_to_group'
            : 'remove_from_group';

      const rpcParams: Record<string, unknown> = {
        target_type: 'node',
        target_id: nodePath,
        method,
        args: action === 'groups.get' ? [] : [groupName],
      };
      assertEditorRpcAllowed(
        'call',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );

      const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'call', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      if (!resp.ok) return resp;

      const resultUnknown =
        resp.details &&
        typeof resp.details === 'object' &&
        !Array.isArray(resp.details)
          ? (resp.details as Record<string, unknown>).result
          : undefined;
      const result =
        resultUnknown &&
        typeof resultUnknown === 'object' &&
        !Array.isArray(resultUnknown)
          ? (resultUnknown as Record<string, unknown>)
          : null;

      return {
        ok: true,
        summary: `${action} ok`,
        details: {
          nodePath,
          ...(groupName ? { groupName } : {}),
          ...(action === 'groups.get'
            ? { groups: result?.result ?? [] }
            : { result: result?.result ?? null }),
        },
      };
    }

    if (action === 'animation.create_simple') {
      const playerPath = maybeGetString(
        argsObj,
        ['playerPath', 'player_path'],
        'playerPath',
      );
      const animationName = maybeGetString(
        argsObj,
        ['animation', 'animationName', 'animation_name'],
        'animation',
      );
      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
      const property = maybeGetString(argsObj, ['property'], 'property');

      const startValue =
        (argsObj as Record<string, unknown>).startValue ??
        (argsObj as Record<string, unknown>).start_value;
      const endValue =
        (argsObj as Record<string, unknown>).endValue ??
        (argsObj as Record<string, unknown>).end_value;

      const duration =
        asOptionalNumber(
          (argsObj as Record<string, unknown>).duration,
          'duration',
        ) ?? 1.0;
      const replaceExisting =
        asOptionalBoolean(
          (argsObj as Record<string, unknown>).replaceExisting ??
            (argsObj as Record<string, unknown>).replace_existing,
          'replaceExisting',
        ) ?? true;

      if (
        !playerPath ||
        !animationName ||
        !nodePath ||
        !property ||
        endValue === undefined ||
        endValue === null
      ) {
        return {
          ok: false,
          summary:
            'animation.create_simple requires playerPath, animation, nodePath, property, and endValue',
          details: {
            required: [
              'playerPath',
              'animation',
              'nodePath',
              'property',
              'endValue',
            ],
          },
        };
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        return {
          ok: false,
          summary: 'animation.create_simple requires duration > 0',
          details: { required: ['duration'] },
        };
      }

      if (hasEditorConnection(ctx)) {
        const rpcParams: Record<string, unknown> = {
          player_path: playerPath,
          animation_name: animationName,
          node_path: nodePath,
          property,
          duration,
          replace_existing: replaceExisting,
          end_value: endValue,
        };
        if (startValue !== undefined && startValue !== null)
          rpcParams.start_value = startValue;

        assertEditorRpcAllowed(
          'create_simple_animation',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        return await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: {
            method: 'create_simple_animation',
            params: rpcParams,
          },
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
            'Not connected to editor bridge; animation.create_simple requires projectPath and scenePath for headless mode',
          details: {
            required: ['projectPath', 'scenePath'],
            suggestions: [
              'Call godot_workspace_manager(action="connect") to create animations in the currently edited scene.',
              'Or pass projectPath + scenePath to edit the scene file headlessly.',
            ],
          },
        };
      }

      return await callBaseTool(baseHandlers, 'godot_headless_op', {
        projectPath,
        operation: 'create_simple_animation',
        params: {
          scenePath,
          playerPath,
          animation: animationName,
          nodePath,
          property,
          ...(startValue === undefined || startValue === null
            ? {}
            : { startValue }),
          endValue,
          duration,
          replaceExisting,
        },
      });
    }

    if (
      action === 'animation.list' ||
      action === 'animation.play' ||
      action === 'animation.stop' ||
      action === 'animation.seek'
    ) {
      if (!hasEditorConnection(ctx)) return requireEditorConnected(action);

      const playerPath = maybeGetString(
        argsObj,
        ['playerPath', 'player_path', 'nodePath', 'node_path'],
        'playerPath',
      );
      if (!playerPath) {
        return {
          ok: false,
          summary: `${action} requires playerPath`,
          details: { required: ['playerPath'] },
        };
      }

      if (action === 'animation.list') {
        const rpcParams: Record<string, unknown> = {
          target_type: 'node',
          target_id: playerPath,
          method: 'get_animation_list',
          args: [],
        };
        assertEditorRpcAllowed(
          'call',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'call', params: rpcParams },
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        if (!resp.ok) return resp;

        const resultUnknown =
          resp.details &&
          typeof resp.details === 'object' &&
          !Array.isArray(resp.details)
            ? (resp.details as Record<string, unknown>).result
            : undefined;
        const result =
          resultUnknown &&
          typeof resultUnknown === 'object' &&
          !Array.isArray(resultUnknown)
            ? (resultUnknown as Record<string, unknown>)
            : null;

        return {
          ok: true,
          summary: 'animation.list ok',
          details: { playerPath, animations: result?.result ?? [] },
        };
      }

      if (action === 'animation.stop') {
        const rpcParams: Record<string, unknown> = {
          target_type: 'node',
          target_id: playerPath,
          method: 'stop',
          args: [],
        };
        assertEditorRpcAllowed(
          'call',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'call', params: rpcParams },
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        return {
          ok: resp.ok,
          summary: resp.ok ? 'animation.stop ok' : 'animation.stop failed',
          details: { playerPath, response: resp },
          logs: resp.logs,
        };
      }

      const startTimeRaw =
        (argsObj as Record<string, unknown>).startTime ??
        (argsObj as Record<string, unknown>).start_time;
      const startTime = asOptionalNumber(startTimeRaw, 'startTime');

      if (action === 'animation.seek') {
        if (
          startTime === undefined ||
          !Number.isFinite(startTime) ||
          startTime < 0
        ) {
          return {
            ok: false,
            summary: 'animation.seek requires startTime (>= 0)',
            details: { required: ['playerPath', 'startTime'] },
          };
        }
        const rpcParams: Record<string, unknown> = {
          target_type: 'node',
          target_id: playerPath,
          method: 'seek',
          args: [startTime, true],
        };
        assertEditorRpcAllowed(
          'call',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'call', params: rpcParams },
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        return {
          ok: resp.ok,
          summary: resp.ok ? 'animation.seek ok' : 'animation.seek failed',
          details: { playerPath, startTime, response: resp },
          logs: resp.logs,
        };
      }

      const animation = asNonEmptyString(
        (argsObj as Record<string, unknown>).animation,
        'animation',
      );
      const backwards =
        asOptionalBoolean(
          (argsObj as Record<string, unknown>).backwards,
          'backwards',
        ) ?? false;

      const playParams: Record<string, unknown> = {
        target_type: 'node',
        target_id: playerPath,
        method: 'play',
        args: [animation, -1, 1.0, backwards],
      };
      assertEditorRpcAllowed(
        'call',
        playParams,
        ctx.getEditorProjectPath() ?? '',
      );
      const playResp = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'call', params: playParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      if (!playResp.ok) return playResp;

      if (
        startTime !== undefined &&
        Number.isFinite(startTime) &&
        startTime > 0
      ) {
        const seekParams: Record<string, unknown> = {
          target_type: 'node',
          target_id: playerPath,
          method: 'seek',
          args: [startTime, true],
        };
        assertEditorRpcAllowed(
          'call',
          seekParams,
          ctx.getEditorProjectPath() ?? '',
        );
        const seekResp = await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: { method: 'call', params: seekParams },
          ...(timeoutMs ? { timeoutMs } : {}),
        });
        if (!seekResp.ok) return seekResp;
      }

      return {
        ok: true,
        summary: 'animation.play ok',
        details: {
          playerPath,
          animation,
          startTime: startTime ?? 0,
          backwards,
        },
      };
    }

    if (action === 'audio.play' || action === 'audio.stop') {
      if (!hasEditorConnection(ctx)) return requireEditorConnected(action);

      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
      if (!nodePath) {
        return {
          ok: false,
          summary: `${action} requires nodePath`,
          details: { required: ['nodePath'] },
        };
      }

      const rpcParams: Record<string, unknown> = {
        target_type: 'node',
        target_id: nodePath,
        method: action === 'audio.play' ? 'play' : 'stop',
        args: [],
      };
      assertEditorRpcAllowed(
        'call',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'call', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      return {
        ok: resp.ok,
        summary: resp.ok ? `${action} ok` : `${action} failed`,
        details: { nodePath, response: resp },
        logs: resp.logs,
      };
    }

    if (action === 'audio.set_bus_volume') {
      if (!hasEditorConnection(ctx))
        return requireEditorConnected('audio.set_bus_volume');

      const bus = asNonEmptyString(
        (argsObj as Record<string, unknown>).bus,
        'bus',
      );
      const volumeDbRaw =
        (argsObj as Record<string, unknown>).volumeDb ??
        (argsObj as Record<string, unknown>).volume_db;
      const volumeDb = asOptionalNumber(volumeDbRaw, 'volumeDb');
      if (volumeDb === undefined) {
        return {
          ok: false,
          summary: 'audio.set_bus_volume requires volumeDb',
          details: { required: ['bus', 'volumeDb'] },
        };
      }

      const getIdxParams: Record<string, unknown> = {
        target_type: 'singleton',
        target_id: 'AudioServer',
        method: 'get_bus_index',
        args: [bus],
      };
      assertEditorRpcAllowed(
        'call',
        getIdxParams,
        ctx.getEditorProjectPath() ?? '',
      );
      const idxResp = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'call', params: getIdxParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      if (!idxResp.ok) return idxResp;

      const idxResultUnknown =
        idxResp.details &&
        typeof idxResp.details === 'object' &&
        !Array.isArray(idxResp.details)
          ? (idxResp.details as Record<string, unknown>).result
          : undefined;
      const idxResult =
        idxResultUnknown &&
        typeof idxResultUnknown === 'object' &&
        !Array.isArray(idxResultUnknown)
          ? (idxResultUnknown as Record<string, unknown>)
          : null;
      const busIndexRaw = idxResult?.result;
      const busIndex =
        typeof busIndexRaw === 'number'
          ? Math.floor(busIndexRaw)
          : typeof busIndexRaw === 'string' && /^[0-9-]+$/u.test(busIndexRaw)
            ? Number.parseInt(busIndexRaw, 10)
            : null;

      if (busIndex === null || busIndex < 0) {
        return {
          ok: false,
          summary: 'audio.set_bus_volume: bus not found',
          details: { bus, busIndex },
        };
      }

      const setParams: Record<string, unknown> = {
        target_type: 'singleton',
        target_id: 'AudioServer',
        method: 'set_bus_volume_db',
        args: [busIndex, volumeDb],
      };
      assertEditorRpcAllowed(
        'call',
        setParams,
        ctx.getEditorProjectPath() ?? '',
      );
      const setResp = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'call', params: setParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      if (!setResp.ok) return setResp;

      return {
        ok: true,
        summary: 'audio.set_bus_volume ok',
        details: { bus, busIndex, volumeDb },
      };
    }

    if (action === 'focus_node') {
      if (!hasEditorConnection(ctx))
        return requireEditorConnected('focus_node');

      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
      if (!nodePath) {
        return {
          ok: false,
          summary: 'focus_node requires nodePath',
          details: { required: ['nodePath'] },
        };
      }

      const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: {
          method: 'viewport.focus_node',
          params: { node_path: nodePath },
        },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      return {
        ok: resp.ok,
        summary: resp.ok ? 'focus_node ok' : 'focus_node failed',
        details: { response: resp },
        logs: resp.logs,
      };
    }

    if (action === 'shader.set_param') {
      if (!hasEditorConnection(ctx))
        return requireEditorConnected('shader.set_param');

      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
      if (!nodePath) {
        return {
          ok: false,
          summary: 'shader.set_param requires nodePath',
          details: { required: ['nodePath'] },
        };
      }

      const param = asNonEmptyString(
        (argsObj as Record<string, unknown>).param,
        'param',
      );
      const value = (argsObj as Record<string, unknown>).value;
      const materialProperty =
        asOptionalString(
          (argsObj as Record<string, unknown>).materialProperty,
          'materialProperty',
        )?.trim() || 'material_override';
      const surfaceIndex =
        asOptionalNumber(
          (argsObj as Record<string, unknown>).surfaceIndex ??
            (argsObj as Record<string, unknown>).surface_index,
          'surfaceIndex',
        ) ?? 0;
      const surfaceIndexInt = Math.max(0, Math.floor(surfaceIndex));

      const rpcParams: Record<string, unknown> = {
        node_path: nodePath,
        param,
        value,
        material_property: materialProperty,
        surface_index: surfaceIndexInt,
      };
      assertEditorRpcAllowed(
        'set_shader_param',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'set_shader_param', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      return {
        ok: resp.ok,
        summary: resp.ok ? 'shader.set_param ok' : 'shader.set_param failed',
        details: {
          nodePath,
          materialProperty,
          surfaceIndex: surfaceIndexInt,
          param,
          response: resp,
        },
        logs: resp.logs,
      };
    }

    if (action === 'set_collision_layer') {
      const nodePath = maybeGetString(
        argsObj,
        ['nodePath', 'node_path'],
        'nodePath',
      );
      if (!nodePath) {
        return {
          ok: false,
          summary: 'set_collision_layer requires nodePath',
          details: { required: ['nodePath'] },
        };
      }

      const collisionLayer = resolveCollisionMask(
        (argsObj as Record<string, unknown>).collisionLayer ??
          (argsObj as Record<string, unknown>).collision_layer,
        (argsObj as Record<string, unknown>).collisionLayerBits ??
          (argsObj as Record<string, unknown>).collision_layer_bits,
        'collisionLayer',
      );
      const collisionMask = resolveCollisionMask(
        (argsObj as Record<string, unknown>).collisionMask ??
          (argsObj as Record<string, unknown>).collision_mask,
        (argsObj as Record<string, unknown>).collisionMaskBits ??
          (argsObj as Record<string, unknown>).collision_mask_bits,
        'collisionMask',
      );

      if (collisionLayer === undefined && collisionMask === undefined) {
        return {
          ok: false,
          summary:
            'set_collision_layer requires at least one of collisionLayer/collisionMask (or bit arrays)',
          details: {
            required: ['nodePath', 'collisionLayer|collisionMask'],
          },
        };
      }

      const nextProps: Record<string, unknown> = {};
      if (collisionLayer !== undefined)
        nextProps.collision_layer = collisionLayer;
      if (collisionMask !== undefined) nextProps.collision_mask = collisionMask;

      if (hasEditorConnection(ctx)) {
        const steps = Object.entries(nextProps).map(([property, value]) => ({
          method: 'set_property',
          params: { node_path: nodePath, property, value },
        }));
        return await callBaseTool(baseHandlers, 'godot_editor_batch', {
          actionName: 'godot_inspector_manager:set_collision_layer',
          steps,
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
            'Not connected to editor bridge; set_collision_layer requires projectPath and scenePath for headless mode',
          details: { required: ['projectPath', 'scenePath'] },
        };
      }

      return await callBaseTool(baseHandlers, 'godot_headless_op', {
        projectPath,
        operation: 'set_node_properties',
        params: { scenePath, nodePath, props: nextProps },
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
