import type { ServerContext } from './context.js';
import type { ToolHandler } from './types.js';

import { createAssetManagerHandler } from './unified/asset_manager.js';
import { createEditorViewManagerHandler } from './unified/editor_view_manager.js';
import { createInspectorManagerHandler } from './unified/inspector_manager.js';
import { createLogManagerHandler } from './unified/log_manager.js';
import { createSceneManagerHandler } from './unified/scene_manager.js';
import { createWorkspaceManagerHandler } from './unified/workspace_manager.js';
import type { BaseToolHandlers } from './unified/shared.js';

export function createUnifiedToolHandlers(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): Record<string, ToolHandler> {
  return {
    godot_scene_manager: createSceneManagerHandler(ctx, baseHandlers),
    godot_inspector_manager: createInspectorManagerHandler(ctx, baseHandlers),
    godot_asset_manager: createAssetManagerHandler(ctx, baseHandlers),
    godot_workspace_manager: createWorkspaceManagerHandler(ctx, baseHandlers),
    godot_log_manager: createLogManagerHandler(ctx, baseHandlers),
    godot_editor_view_manager: createEditorViewManagerHandler(
      ctx,
      baseHandlers,
    ),
  };
}
