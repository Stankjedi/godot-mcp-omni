import { assertDangerousOpsAllowed } from '../security.js';
import { asNonEmptyString, asOptionalNumber, asRecord } from '../validation.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';

import {
  callBaseTool,
  normalizeAction,
  supportedActionError,
  type BaseToolHandlers,
} from './unified/shared.js';

const SUPPORTED_ACTIONS = [
  'project_info.get',
  'save_game_data',
  'load_game_data',
  'input_map.setup',
  'project_setting.set',
  'project_setting.get',
  'errors.get_recent',
] as const;

type SupportedAction = (typeof SUPPORTED_ACTIONS)[number];

function parseErrorsFromDebugOutput(
  debugResp: ToolResponse,
  maxMatches: number,
): string[] {
  const details =
    debugResp.details &&
    typeof debugResp.details === 'object' &&
    !Array.isArray(debugResp.details)
      ? (debugResp.details as Record<string, unknown>)
      : null;
  const output = Array.isArray(details?.output)
    ? (details?.output as unknown[]).filter(
        (v): v is string => typeof v === 'string',
      )
    : [];
  const errors = Array.isArray(details?.errors)
    ? (details?.errors as unknown[]).filter(
        (v): v is string => typeof v === 'string',
      )
    : [];

  const combined = [...errors, ...output].map((l) => l.trim()).filter(Boolean);
  const filtered = combined.filter((l) =>
    /error|exception|panic|failed|parse error/iu.test(l),
  );
  return filtered.slice(0, maxMatches);
}

export function createProjectConfigManagerToolHandlers(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): Record<string, ToolHandler> {
  return {
    godot_project_config_manager: async (
      args: unknown,
    ): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw) as SupportedAction;

      if (!SUPPORTED_ACTIONS.includes(action)) {
        return supportedActionError('godot_project_config_manager', actionRaw, [
          ...SUPPORTED_ACTIONS,
        ]);
      }

      if (action === 'errors.get_recent') {
        const maxMatches = Math.max(
          1,
          Math.min(
            200,
            Math.floor(
              asOptionalNumber(argsObj.maxMatches, 'maxMatches') ?? 50,
            ),
          ),
        );
        const debugResp = await callBaseTool(
          baseHandlers,
          'get_debug_output',
          {},
        );
        const issues = debugResp.ok
          ? parseErrorsFromDebugOutput(debugResp, maxMatches)
          : [];
        return {
          ok: debugResp.ok,
          summary: debugResp.ok
            ? 'errors.get_recent ok'
            : 'errors.get_recent failed',
          details: {
            maxMatches,
            issues,
            debug: debugResp,
          },
          logs: debugResp.logs,
        };
      }

      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);

      if (action === 'project_info.get') {
        return await callBaseTool(baseHandlers, 'get_project_info', {
          projectPath,
        });
      }

      if (action === 'save_game_data') {
        // Gate user:// writes behind the same guardrail as other potentially-destructive ops.
        assertDangerousOpsAllowed('project_settings_save_game_data');

        const key = asNonEmptyString(argsObj.key, 'key');
        const value = (argsObj as Record<string, unknown>).value;
        return await callBaseTool(baseHandlers, 'godot_headless_op', {
          projectPath,
          operation: 'project_config_save_game_data_v1',
          params: { key, value },
        });
      }

      if (action === 'load_game_data') {
        assertDangerousOpsAllowed('project_settings_load_game_data');

        const key = asNonEmptyString(argsObj.key, 'key');
        const hasDefault = Object.prototype.hasOwnProperty.call(
          argsObj,
          'defaultValue',
        );
        const defaultValue = hasDefault
          ? (argsObj as Record<string, unknown>).defaultValue
          : undefined;
        return await callBaseTool(baseHandlers, 'godot_headless_op', {
          projectPath,
          operation: 'project_config_load_game_data_v1',
          params: {
            key,
            ...(hasDefault ? { default_value: defaultValue } : {}),
          },
        });
      }

      if (action === 'input_map.setup') {
        assertDangerousOpsAllowed('project_settings_input_map_setup');

        const actions = (argsObj as Record<string, unknown>).actions;
        if (!Array.isArray(actions)) {
          return {
            ok: false,
            summary: 'input_map.setup requires actions[]',
            details: { required: ['actions'] },
          };
        }
        return await callBaseTool(baseHandlers, 'godot_headless_op', {
          projectPath,
          operation: 'project_config_input_map_setup_v1',
          params: { actions },
        });
      }

      if (action === 'project_setting.set') {
        assertDangerousOpsAllowed('project_settings_set');

        const key = asNonEmptyString(argsObj.key, 'key');
        const value = (argsObj as Record<string, unknown>).value;
        return await callBaseTool(baseHandlers, 'godot_headless_op', {
          projectPath,
          operation: 'project_config_project_setting_set_v1',
          params: { key, value },
        });
      }

      if (action === 'project_setting.get') {
        const key = asNonEmptyString(argsObj.key, 'key');
        return await callBaseTool(baseHandlers, 'godot_headless_op', {
          projectPath,
          operation: 'project_config_project_setting_get_v1',
          params: { key },
        });
      }

      const _exhaustive: never = action;
      return {
        ok: false,
        summary: `Unknown action: ${String(_exhaustive)}`,
        details: { supportedActions: SUPPORTED_ACTIONS },
      };
    },
  };
}
