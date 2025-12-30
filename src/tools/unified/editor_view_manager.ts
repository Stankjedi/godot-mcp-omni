import fs from 'fs';
import path from 'path';

import { assertEditorRpcAllowed } from '../../security.js';
import {
  asNonEmptyString,
  asOptionalNonNegativeInteger,
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
  normalizeScreenName,
  requireEditorConnected,
  supportedActionError,
} from './shared.js';

export function createEditorViewManagerHandler(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): ToolHandler {
  return async (args: unknown): Promise<ToolResponse> => {
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

    if (!hasEditorConnection(ctx))
      return requireEditorConnected('godot_editor_view_manager');

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

      const savePath = maybeGetString(
        argsObj,
        ['savePath', 'save_path'],
        'savePath',
      );
      if (response.ok && savePath) {
        try {
          const resultUnknown = response.details?.result as unknown;
          const result =
            resultUnknown &&
            typeof resultUnknown === 'object' &&
            !Array.isArray(resultUnknown)
              ? (resultUnknown as Record<string, unknown>)
              : null;
          const b64 = result ? result.base64 : undefined;
          if (typeof b64 === 'string') {
            const buffer = Buffer.from(b64, 'base64');
            const fullPath = path.resolve(savePath);
            fs.writeFileSync(fullPath, buffer);
            response.summary = `Viewport captured and saved to: ${fullPath}`;
            if (response.details) {
              response.details.saved_path = fullPath;
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
  };
}
