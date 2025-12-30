import {
  asNonEmptyString,
  asRecord,
  ValidationError,
  valueType,
} from '../validation.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';
import {
  callBaseTool,
  normalizeAction,
  supportedActionError,
  type BaseToolHandlers,
} from './unified/shared.js';

const ACTION_TO_TOOL: Record<string, string> = {
  project_analyze: 'pixel_project_analyze',
  goal_to_spec: 'pixel_goal_to_spec',
  tilemap_generate: 'pixel_tilemap_generate',
  world_generate: 'pixel_world_generate',
  layer_ensure: 'pixel_layer_ensure',
  object_generate: 'pixel_object_generate',
  object_place: 'pixel_object_place',
  export_preview: 'pixel_export_preview',
  smoke_test: 'pixel_smoke_test',
  macro_run: 'pixel_macro_run',
  manifest_get: 'pixel_manifest_get',
};

const SUPPORTED_ACTIONS = Object.keys(ACTION_TO_TOOL);

export function createPixelManagerToolHandlers(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): Record<string, ToolHandler> {
  return {
    pixel_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);

      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw);
      const toolName = ACTION_TO_TOOL[action];
      if (!toolName) {
        return supportedActionError('pixel_manager', action, SUPPORTED_ACTIONS);
      }

      const forwardedArgs: Record<string, unknown> = { ...argsObj };
      delete forwardedArgs.action;

      try {
        return await callBaseTool(baseHandlers, toolName, forwardedArgs);
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        return {
          ok: false,
          summary: `pixel_manager: failed to run ${toolName}`,
          details: {
            toolName,
            error: error instanceof Error ? error.message : String(error),
            receivedType: valueType(args),
          },
        };
      }
    },
  };
}
