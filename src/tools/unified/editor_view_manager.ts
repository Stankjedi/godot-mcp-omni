import fs from 'fs';
import path from 'path';

import { assertEditorRpcAllowed } from '../../security.js';
import {
  asNonEmptyString,
  asOptionalBoolean,
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
      'list_open_scripts',
      'panel.find',
      'panel.read',
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

    if (action === 'list_open_scripts') {
      assertEditorRpcAllowed(
        'script.list_open',
        {},
        ctx.getEditorProjectPath() ?? '',
      );
      return await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'script.list_open', params: {} },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
    }

    if (action === 'panel.find') {
      const rootPath = maybeGetString(
        argsObj,
        ['rootPath', 'root_path'],
        'rootPath',
      );
      const nameContains = maybeGetString(
        argsObj,
        ['nameContains', 'name_contains'],
        'nameContains',
      );
      const className = maybeGetString(
        argsObj,
        ['className', 'class_name'],
        'className',
      );
      const textContains = maybeGetString(
        argsObj,
        ['textContains', 'text_contains'],
        'textContains',
      );

      const visibleOnly =
        asOptionalBoolean(argsObj.visibleOnly, 'visibleOnly') ??
        asOptionalBoolean(argsObj.visible_only, 'visible_only');
      const maxResults =
        asOptionalNonNegativeInteger(argsObj.maxResults, 'maxResults') ??
        asOptionalNonNegativeInteger(argsObj.max_results, 'max_results');
      const maxNodes =
        asOptionalNonNegativeInteger(argsObj.maxNodes, 'maxNodes') ??
        asOptionalNonNegativeInteger(argsObj.max_nodes, 'max_nodes');
      const includeTextPreview =
        asOptionalBoolean(argsObj.includeTextPreview, 'includeTextPreview') ??
        asOptionalBoolean(argsObj.include_text_preview, 'include_text_preview');

      const rpcParams: Record<string, unknown> = {};
      if (rootPath) rpcParams.root_path = rootPath;
      if (nameContains) rpcParams.name_contains = nameContains;
      if (className) rpcParams.class_name = className;
      if (textContains) rpcParams.text_contains = textContains;
      if (visibleOnly !== undefined) rpcParams.visible_only = visibleOnly;
      if (maxResults !== undefined) rpcParams.max_results = maxResults;
      if (maxNodes !== undefined) rpcParams.max_nodes = maxNodes;
      if (includeTextPreview !== undefined)
        rpcParams.include_text_preview = includeTextPreview;

      assertEditorRpcAllowed(
        'panel.find',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      return await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'panel.find', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });
    }

    if (action === 'panel.read') {
      const panelPath = maybeGetString(
        argsObj,
        ['panelPath', 'panel_path', 'rootPath'],
        'panelPath',
      );
      if (!panelPath) {
        return {
          ok: false,
          summary: 'panel.read requires panelPath',
          details: { required: ['panelPath'] },
        };
      }

      const visibleOnly =
        asOptionalBoolean(argsObj.visibleOnly, 'visibleOnly') ??
        asOptionalBoolean(argsObj.visible_only, 'visible_only');
      const includePaths =
        asOptionalBoolean(argsObj.includePaths, 'includePaths') ??
        asOptionalBoolean(argsObj.include_paths, 'include_paths');
      const includeTextEdits =
        asOptionalBoolean(argsObj.includeTextEdits, 'includeTextEdits') ??
        asOptionalBoolean(argsObj.include_text_edits, 'include_text_edits');
      const includeTreeItems =
        asOptionalBoolean(argsObj.includeTreeItems, 'includeTreeItems') ??
        asOptionalBoolean(argsObj.include_tree_items, 'include_tree_items');
      const includeItemLists =
        asOptionalBoolean(argsObj.includeItemLists, 'includeItemLists') ??
        asOptionalBoolean(argsObj.include_item_lists, 'include_item_lists');
      const maxNodes =
        asOptionalNonNegativeInteger(argsObj.maxNodes, 'maxNodes') ??
        asOptionalNonNegativeInteger(argsObj.max_nodes, 'max_nodes');
      const maxChars =
        asOptionalNonNegativeInteger(argsObj.maxChars, 'maxChars') ??
        asOptionalNonNegativeInteger(argsObj.max_chars, 'max_chars');
      const maxItems =
        asOptionalNonNegativeInteger(argsObj.maxItems, 'maxItems') ??
        asOptionalNonNegativeInteger(argsObj.max_items, 'max_items');
      const returnEntries =
        asOptionalBoolean(argsObj.returnEntries, 'returnEntries') ??
        asOptionalBoolean(argsObj.return_entries, 'return_entries');

      const rpcParams: Record<string, unknown> = {
        panel_path: panelPath,
      };
      if (visibleOnly !== undefined) rpcParams.visible_only = visibleOnly;
      if (includePaths !== undefined) rpcParams.include_paths = includePaths;
      if (includeTextEdits !== undefined)
        rpcParams.include_text_edits = includeTextEdits;
      if (includeTreeItems !== undefined)
        rpcParams.include_tree_items = includeTreeItems;
      if (includeItemLists !== undefined)
        rpcParams.include_item_lists = includeItemLists;
      if (maxNodes !== undefined) rpcParams.max_nodes = maxNodes;
      if (maxChars !== undefined) rpcParams.max_chars = maxChars;
      if (maxItems !== undefined) rpcParams.max_items = maxItems;
      if (returnEntries !== undefined) rpcParams.return_entries = returnEntries;

      assertEditorRpcAllowed(
        'panel.read',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      return await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'panel.read', params: rpcParams },
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
