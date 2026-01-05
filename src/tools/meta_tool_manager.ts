import {
  asNonEmptyString,
  asRecord,
  ValidationError,
  valueType,
} from '../validation.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';
import { createServerInfoToolHandlers } from './server_info_tool.js';
import { normalizeAction, supportedActionError } from './unified/shared.js';

const SUPPORTED_ACTIONS = ['server_info', 'tool_search', 'tool_help'];

export function createMetaToolManagerToolHandlers(
  ctx: ServerContext,
): Record<string, ToolHandler> {
  const legacy = createServerInfoToolHandlers(ctx);

  return {
    meta_tool_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw);
      if (!SUPPORTED_ACTIONS.includes(action)) {
        return supportedActionError(
          'meta_tool_manager',
          actionRaw,
          SUPPORTED_ACTIONS,
        );
      }

      const forwardedArgs: Record<string, unknown> = { ...argsObj };
      delete forwardedArgs.action;

      if (action === 'tool_help' && forwardedArgs.toolAction !== undefined) {
        forwardedArgs.action = forwardedArgs.toolAction;
        delete forwardedArgs.toolAction;
      }

      try {
        if (action === 'server_info')
          return await legacy.server_info(forwardedArgs);
        if (action === 'tool_search')
          return await legacy.godot_tool_search(forwardedArgs);
        return await legacy.godot_tool_help(forwardedArgs);
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        return {
          ok: false,
          summary: `meta_tool_manager: failed to run ${action}`,
          details: {
            action,
            error: error instanceof Error ? error.message : String(error),
            receivedType: valueType(args),
          },
        };
      }
    },
  };
}
