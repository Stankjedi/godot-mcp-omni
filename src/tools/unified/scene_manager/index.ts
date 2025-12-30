import {
  asNonEmptyString,
  asOptionalPositiveNumber,
  asRecord,
} from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolHandler, ToolResponse } from '../../types.js';

import {
  normalizeAction,
  supportedActionError,
  type BaseToolHandlers,
} from '../shared.js';

import { createMaybeCaptureViewport } from './capture_viewport.js';
import { handleAttachComponents } from './attach_components.js';
import { handleAttachScript } from './attach_script.js';
import { handleBatchCreate } from './batch_create.js';
import { handleCreate } from './create.js';
import { handleCreateTilemap } from './create_tilemap.js';
import { handleCreateUI } from './create_ui.js';
import { handleInstance } from './instance.js';
import {
  handleDuplicate,
  handleRemove,
  handleReparent,
  handleUndoRedo,
} from './simple_actions.js';
import { handleUpdate } from './update.js';

export function createSceneManagerHandler(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): ToolHandler {
  const maybeCaptureViewport = createMaybeCaptureViewport(ctx, baseHandlers);

  return async (args: unknown): Promise<ToolResponse> => {
    const argsObj = asRecord(args, 'args');
    const actionRaw = asNonEmptyString(argsObj.action, 'action');
    const action = normalizeAction(actionRaw);
    const timeoutMs = asOptionalPositiveNumber(argsObj.timeoutMs, 'timeoutMs');

    const supportedActions = [
      'create',
      'update',
      'batch_create',
      'create_tilemap',
      'create_ui',
      'attach_script',
      'attach_components',
      'duplicate',
      'reparent',
      'instance',
      'remove',
      'undo',
      'redo',
    ];

    if (action === 'create') {
      return await handleCreate(
        ctx,
        baseHandlers,
        argsObj,
        timeoutMs,
        maybeCaptureViewport,
      );
    }

    if (action === 'batch_create') {
      return await handleBatchCreate(
        ctx,
        baseHandlers,
        argsObj,
        timeoutMs,
        maybeCaptureViewport,
      );
    }

    if (action === 'create_tilemap') {
      return await handleCreateTilemap(
        ctx,
        baseHandlers,
        argsObj,
        timeoutMs,
        maybeCaptureViewport,
      );
    }

    if (action === 'create_ui') {
      return await handleCreateUI(
        ctx,
        baseHandlers,
        argsObj,
        timeoutMs,
        maybeCaptureViewport,
      );
    }

    if (action === 'attach_script') {
      return await handleAttachScript(ctx, baseHandlers, argsObj, timeoutMs);
    }

    if (action === 'attach_components') {
      return await handleAttachComponents(
        ctx,
        baseHandlers,
        argsObj,
        timeoutMs,
        maybeCaptureViewport,
      );
    }

    if (action === 'update') {
      return await handleUpdate(
        ctx,
        baseHandlers,
        argsObj,
        timeoutMs,
        maybeCaptureViewport,
      );
    }

    if (action === 'duplicate') {
      return await handleDuplicate(ctx, baseHandlers, argsObj, timeoutMs);
    }

    if (action === 'reparent') {
      return await handleReparent(ctx, baseHandlers, argsObj, timeoutMs);
    }

    if (action === 'instance') {
      return await handleInstance(ctx, baseHandlers, argsObj, timeoutMs);
    }

    if (action === 'remove') {
      return await handleRemove(ctx, baseHandlers, argsObj, timeoutMs);
    }

    if (action === 'undo' || action === 'redo') {
      return await handleUndoRedo(ctx, baseHandlers, action, timeoutMs);
    }

    return supportedActionError(
      'godot_scene_manager',
      actionRaw,
      supportedActions,
    );
  };
}
