import { assertEditorRpcAllowed } from '../../../security.js';
import { asOptionalNonNegativeInteger } from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import {
  callBaseTool,
  hasEditorConnection,
  maybeGetString,
  requireEditorConnected,
  type BaseToolHandlers,
} from '../shared.js';

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
  return await callBaseTool(baseHandlers, 'godot_duplicate_node', {
    nodePath,
    ...(newName ? { newName } : {}),
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
  return await callBaseTool(baseHandlers, 'godot_reparent_node', {
    nodePath,
    newParentPath,
    ...(index === undefined ? {} : { index }),
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
