import { assertEditorRpcAllowed } from '../../../security.js';
import {
  asOptionalBoolean,
  asOptionalNonNegativeInteger,
} from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import {
  callBaseTool,
  hasEditorConnection,
  maybeGetString,
  requireEditorConnected,
  type BaseToolHandlers,
} from '../shared.js';

export async function handleRename(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
  timeoutMs: number | undefined,
): Promise<ToolResponse> {
  const nodePath = maybeGetString(
    argsObj,
    ['nodePath', 'node_path'],
    'nodePath',
  );
  const newName = maybeGetString(argsObj, ['newName', 'new_name'], 'newName');
  const ensureUniqueName =
    asOptionalBoolean(argsObj.ensureUniqueName, 'ensureUniqueName') ?? false;

  if (!nodePath || !newName) {
    return {
      ok: false,
      summary: 'rename requires nodePath and newName',
      details: { required: ['nodePath', 'newName'] },
    };
  }

  if (hasEditorConnection(ctx)) {
    const rpcParams: Record<string, unknown> = {
      node_path: nodePath,
      new_name: newName,
      ensure_unique_name: ensureUniqueName,
    };
    assertEditorRpcAllowed(
      'rename_node',
      rpcParams,
      ctx.getEditorProjectPath() ?? '',
    );
    return await callBaseTool(baseHandlers, 'godot_rpc', {
      request_json: { method: 'rename_node', params: rpcParams },
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
        'Not connected to editor bridge; rename requires projectPath and scenePath for headless mode',
      details: {
        required: ['projectPath', 'scenePath'],
        suggestions: [
          'Call godot_workspace_manager(action="connect") to rename nodes in the currently edited scene.',
          'Or pass projectPath + scenePath to edit the scene file headlessly.',
        ],
      },
    };
  }

  return await callBaseTool(baseHandlers, 'godot_headless_op', {
    projectPath,
    operation: 'rename_node',
    params: { scenePath, nodePath, newName, ensureUniqueName },
  });
}

export async function handleMove(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
  timeoutMs: number | undefined,
): Promise<ToolResponse> {
  const nodePath = maybeGetString(
    argsObj,
    ['nodePath', 'node_path'],
    'nodePath',
  );
  const index = asOptionalNonNegativeInteger(argsObj.index, 'index');

  if (!nodePath || index === undefined) {
    return {
      ok: false,
      summary: 'move requires nodePath and index',
      details: { required: ['nodePath', 'index'] },
    };
  }

  if (hasEditorConnection(ctx)) {
    const rpcParams: Record<string, unknown> = { node_path: nodePath, index };
    assertEditorRpcAllowed(
      'move_node',
      rpcParams,
      ctx.getEditorProjectPath() ?? '',
    );
    return await callBaseTool(baseHandlers, 'godot_rpc', {
      request_json: { method: 'move_node', params: rpcParams },
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
        'Not connected to editor bridge; move requires projectPath and scenePath for headless mode',
      details: {
        required: ['projectPath', 'scenePath'],
        suggestions: [
          'Call godot_workspace_manager(action="connect") to reorder nodes in the currently edited scene.',
          'Or pass projectPath + scenePath to edit the scene file headlessly.',
        ],
      },
    };
  }

  return await callBaseTool(baseHandlers, 'godot_headless_op', {
    projectPath,
    operation: 'move_node',
    params: { scenePath, nodePath, index },
  });
}

export async function handleDuplicate(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
  timeoutMs: number | undefined,
): Promise<ToolResponse> {
  if (!hasEditorConnection(ctx)) return requireEditorConnected('duplicate');
  const nodePath = maybeGetString(
    argsObj,
    ['nodePath', 'node_path'],
    'nodePath',
  );
  if (!nodePath) {
    return {
      ok: false,
      summary: 'duplicate requires nodePath',
      details: { required: ['nodePath'] },
    };
  }
  const newName = maybeGetString(argsObj, ['newName', 'new_name'], 'newName');

  const rpcParams: Record<string, unknown> = { node_path: nodePath };
  if (newName) rpcParams.new_name = newName;

  assertEditorRpcAllowed(
    'duplicate_node',
    rpcParams,
    ctx.getEditorProjectPath() ?? '',
  );
  return await callBaseTool(baseHandlers, 'godot_rpc', {
    request_json: { method: 'duplicate_node', params: rpcParams },
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

export async function handleReparent(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
  timeoutMs: number | undefined,
): Promise<ToolResponse> {
  if (!hasEditorConnection(ctx)) return requireEditorConnected('reparent');
  const nodePath = maybeGetString(
    argsObj,
    ['nodePath', 'node_path'],
    'nodePath',
  );
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

  const rpcParams: Record<string, unknown> = {
    node_path: nodePath,
    new_parent_path: newParentPath,
    ...(index === undefined ? {} : { index }),
  };

  assertEditorRpcAllowed(
    'reparent_node',
    rpcParams,
    ctx.getEditorProjectPath() ?? '',
  );
  return await callBaseTool(baseHandlers, 'godot_rpc', {
    request_json: { method: 'reparent_node', params: rpcParams },
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

export async function handleRemove(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
  timeoutMs: number | undefined,
): Promise<ToolResponse> {
  if (!hasEditorConnection(ctx)) return requireEditorConnected('remove');
  const nodePath = maybeGetString(
    argsObj,
    ['nodePath', 'node_path'],
    'nodePath',
  );
  if (!nodePath) {
    return {
      ok: false,
      summary: 'remove requires nodePath',
      details: { required: ['nodePath'] },
    };
  }
  const rpcParams: Record<string, unknown> = { node_path: nodePath };
  assertEditorRpcAllowed(
    'remove_node',
    rpcParams,
    ctx.getEditorProjectPath() ?? '',
  );
  return await callBaseTool(baseHandlers, 'godot_rpc', {
    request_json: { method: 'remove_node', params: rpcParams },
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

export async function handleUndoRedo(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  action: 'undo' | 'redo',
  timeoutMs: number | undefined,
): Promise<ToolResponse> {
  if (!hasEditorConnection(ctx)) return requireEditorConnected(action);
  const method = action === 'undo' ? 'undo_redo.undo' : 'undo_redo.redo';
  assertEditorRpcAllowed(method, {}, ctx.getEditorProjectPath() ?? '');
  return await callBaseTool(baseHandlers, 'godot_rpc', {
    request_json: { method, params: {} },
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}
