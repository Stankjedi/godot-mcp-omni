import process from 'node:process';

import { MCP_SERVER_INFO } from '../server_info.js';
import {
  ValidationError,
  asNonEmptyString,
  asOptionalNumber,
  asRecord,
  valueType,
} from '../validation.js';

import {
  ALL_TOOL_DEFINITIONS,
  TOOL_DEFINITION_GROUPS,
} from './definitions/all_tools.js';

import type { ServerContext } from './context.js';
import type { ToolDefinition } from './definitions/tool_definition.js';
import type { ToolHandler, ToolResponse } from './types.js';

export function createServerInfoToolHandlers(
  ctx: ServerContext,
): Record<string, ToolHandler> {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function tokenize(input: string): string[] {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/giu, ' ')
      .split(/\s+/gu)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  function getActionEnum(def: ToolDefinition): string[] {
    const schema = def.inputSchema;
    if (!isRecord(schema)) return [];
    const props = schema.properties;
    if (!isRecord(props)) return [];
    const action = props.action;
    if (!isRecord(action)) return [];
    if (!Array.isArray(action.enum)) return [];
    return action.enum.filter((v): v is string => typeof v === 'string');
  }

  function getActionBranchSchema(
    def: ToolDefinition,
    actionName: string,
  ): Record<string, unknown> | null {
    const schema = def.inputSchema;
    if (!isRecord(schema)) return null;
    const oneOf = schema.oneOf;
    if (!Array.isArray(oneOf)) return null;

    for (const branch of oneOf) {
      if (!isRecord(branch)) continue;
      const props = branch.properties;
      if (!isRecord(props)) continue;
      const action = props.action;
      if (!isRecord(action)) continue;
      if (action.const === actionName) return branch;
    }
    return null;
  }

  function schemaRequiredKeys(
    schema: Record<string, unknown> | null,
  ): string[] {
    if (!schema) return [];
    const required = schema.required;
    if (!Array.isArray(required)) return [];
    return required.filter((v): v is string => typeof v === 'string');
  }

  function schemaProperties(
    schema: Record<string, unknown> | null,
  ): Record<string, unknown> {
    if (!schema) return {};
    const props = schema.properties;
    if (!isRecord(props)) return {};
    return props;
  }

  function placeholderForSchemaValue(valueSchema: unknown): unknown {
    if (!isRecord(valueSchema)) return '<value>';
    if (Array.isArray(valueSchema.anyOf) && valueSchema.anyOf.length > 0) {
      return placeholderForSchemaValue(valueSchema.anyOf[0]);
    }
    const t = valueSchema.type;
    if (t === 'string') return '<string>';
    if (t === 'number' || t === 'integer') return 0;
    if (t === 'boolean') return false;
    if (t === 'array') return [];
    if (t === 'object') return {};
    return '<value>';
  }

  function buildExampleArgs(
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    const required = schemaRequiredKeys(schema);
    const props = schemaProperties(schema);
    const args: Record<string, unknown> = {};
    for (const key of required) {
      if (key === 'action') continue;
      args[key] = placeholderForSchemaValue(props[key]);
    }
    return args;
  }

  const ACTION_ANNOTATIONS: Record<
    string,
    Record<string, Record<string, boolean>>
  > = {
    workflow_manager: {
      validate: { readOnlyHint: true, idempotentHint: true },
      run: { destructiveHint: true },
      'macro.list': { readOnlyHint: true, idempotentHint: true },
      'macro.describe': { readOnlyHint: true, idempotentHint: true },
      'macro.manifest_get': { readOnlyHint: true, idempotentHint: true },
      'macro.plan': { readOnlyHint: true, idempotentHint: true },
      'macro.run': { destructiveHint: true },
      'macro.resume': { destructiveHint: true },
      'macro.validate': { readOnlyHint: true, idempotentHint: true },
    },
    godot_workspace_manager: {
      status: { readOnlyHint: true, idempotentHint: true },
      get_state: { readOnlyHint: true, idempotentHint: true },
      smoke_test: { readOnlyHint: true },
      'guidelines.search': { readOnlyHint: true, idempotentHint: true },
      'guidelines.get_section': { readOnlyHint: true, idempotentHint: true },
      'docs.search': { readOnlyHint: true, idempotentHint: true },
      'docs.get_class': { readOnlyHint: true, idempotentHint: true },
      save_scene: { destructiveHint: true },
      save_all: { destructiveHint: true },
      doctor_report: { destructiveHint: true },
    },
    godot_scene_manager: {
      create: { destructiveHint: true },
      update: { destructiveHint: true },
      batch_create: { destructiveHint: true },
      create_tilemap: { destructiveHint: true },
      create_ui: { destructiveHint: true },
      attach_script: { destructiveHint: true },
      attach_components: { destructiveHint: true },
      duplicate: { destructiveHint: true },
      reparent: { destructiveHint: true },
      instance: { destructiveHint: true },
      remove: { destructiveHint: true },
      undo: { destructiveHint: true },
      redo: { destructiveHint: true },
    },
    godot_inspector_manager: {
      query: { readOnlyHint: true, idempotentHint: true },
      inspect: { readOnlyHint: true, idempotentHint: true },
      property_list: { readOnlyHint: true, idempotentHint: true },
      get_property: { readOnlyHint: true, idempotentHint: true },
      get_selection: { readOnlyHint: true, idempotentHint: true },
      method_list: { readOnlyHint: true, idempotentHint: true },
      connect_signal: { destructiveHint: true },
      disconnect_signal: { destructiveHint: true },
      set_property: { destructiveHint: true },
      set_collision_layer: { destructiveHint: true },
    },
    godot_asset_manager: {
      load_texture: { readOnlyHint: true, idempotentHint: true },
      file_exists: { readOnlyHint: true, idempotentHint: true },
      list_resources: { readOnlyHint: true, idempotentHint: true },
      search_files: { readOnlyHint: true, idempotentHint: true },
      scan: { readOnlyHint: true },
      auto_import_check: { readOnlyHint: true },
      uid_convert: { readOnlyHint: true, idempotentHint: true },
      get_uid: { destructiveHint: true },
      create_folder: { destructiveHint: true },
      reimport: { destructiveHint: true },
    },
    godot_builder_manager: {
      lighting_preset: { destructiveHint: true },
      create_primitive: { destructiveHint: true },
      create_ui_template: { destructiveHint: true },
      create_trigger_area: { destructiveHint: true },
      create_rigidbody: { destructiveHint: true },
      set_anchor_preset: { destructiveHint: true },
    },
    godot_code_manager: {
      'script.create': { destructiveHint: true },
      'script.read': { readOnlyHint: true, idempotentHint: true },
      'script.attach': { destructiveHint: true },
      'shader.create': { destructiveHint: true },
      'shader.apply': { destructiveHint: true },
      'file.edit': { destructiveHint: true },
      'file.write_binary': { destructiveHint: true },
    },
    godot_project_config_manager: {
      'project_info.get': { readOnlyHint: true, idempotentHint: true },
      save_game_data: { destructiveHint: true },
      load_game_data: { readOnlyHint: true, idempotentHint: true },
      'input_map.setup': { destructiveHint: true },
      'project_setting.set': { destructiveHint: true },
      'project_setting.get': { readOnlyHint: true, idempotentHint: true },
      'errors.get_recent': { readOnlyHint: true, idempotentHint: true },
    },
  };

  function inferActionAnnotations(
    tool: string,
    actionName: string,
  ): Record<string, boolean> | null {
    const explicit = ACTION_ANNOTATIONS[tool]?.[actionName];
    if (explicit) return explicit;

    const a = actionName.trim().toLowerCase();
    if (!a) return null;

    if (
      a.startsWith('get_') ||
      a.startsWith('list_') ||
      a.startsWith('search_') ||
      a.startsWith('docs.') ||
      a.startsWith('guidelines.') ||
      a.includes('status') ||
      a.includes('inspect') ||
      a.includes('query') ||
      a.includes('help') ||
      a.includes('info') ||
      a.includes('validate')
    ) {
      return { readOnlyHint: true, idempotentHint: true };
    }

    if (
      a.includes('create') ||
      a.includes('update') ||
      a.includes('set') ||
      a.includes('attach') ||
      a.includes('connect') ||
      a.includes('disconnect') ||
      a.includes('remove') ||
      a.includes('delete') ||
      a.includes('duplicate') ||
      a.includes('reparent') ||
      a.includes('instance') ||
      a.includes('save') ||
      a.includes('run') ||
      a.includes('stop') ||
      a.includes('restart') ||
      a.includes('resume') ||
      a.includes('write') ||
      a.includes('reimport')
    ) {
      return { destructiveHint: true };
    }

    return null;
  }

  return {
    server_info: async (args: unknown): Promise<ToolResponse> => {
      asRecord(args, 'args');

      const allowDangerousOps = process.env.ALLOW_DANGEROUS_OPS === 'true';
      const allowExternalTools = process.env.ALLOW_EXTERNAL_TOOLS === 'true';
      const godotPath = process.env.GODOT_PATH ?? '';

      const groups: Record<string, number> = {};
      let toolCount = 0;
      for (const [groupName, defs] of Object.entries(TOOL_DEFINITION_GROUPS)) {
        groups[groupName] = defs.length;
        toolCount += defs.length;
      }

      return {
        ok: true,
        summary: `${MCP_SERVER_INFO.name} ${MCP_SERVER_INFO.version}`,
        details: {
          server: {
            name: MCP_SERVER_INFO.name,
            version: MCP_SERVER_INFO.version,
          },
          runtime: {
            pid: process.pid,
            platform: process.platform,
            node: process.version,
          },
          safety: {
            allowDangerousOps,
            allowExternalTools,
          },
          godot: {
            configured: godotPath.trim().length > 0,
          },
          editorBridge: {
            connected: Boolean(ctx.getEditorClient()),
          },
          tools: {
            count: toolCount,
            groups,
            names: ALL_TOOL_DEFINITIONS.map((t) => t.name).sort((a, b) =>
              a.localeCompare(b),
            ),
          },
        },
        logs: [],
      };
    },

    godot_tool_search: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const query = asNonEmptyString(argsObj.query, 'query');
      const limitRaw = asOptionalNumber(argsObj.limit, 'limit');
      const limit = Math.max(1, Math.min(25, Math.floor(limitRaw ?? 5)));

      const contextObj =
        isRecord(argsObj.context) && !Array.isArray(argsObj.context)
          ? (argsObj.context as Record<string, unknown>)
          : null;
      const headlessPreferred =
        contextObj?.headlessPreferred === true ||
        contextObj?.headlessPreferred === 'true';

      const queryTokens = new Set(tokenize(query));
      const candidates = ALL_TOOL_DEFINITIONS.map((def) => {
        const actions = getActionEnum(def);
        const haystack = [def.name, def.description ?? '', ...actions].join(
          ' ',
        );
        const tokens = tokenize(haystack);
        const match = tokens.filter((t) => queryTokens.has(t));

        const toolAnnotations =
          def.annotations &&
          typeof def.annotations === 'object' &&
          !Array.isArray(def.annotations)
            ? (def.annotations as Record<string, unknown>)
            : {};

        const isManager = def.name.endsWith('_manager');
        const legacyHint = toolAnnotations.legacyHint === true;
        const advancedHint = toolAnnotations.advancedHint === true;
        const headlessHint = toolAnnotations.headlessHint === true;

        const score =
          match.length +
          (isManager ? 2 : 0) +
          (legacyHint ? -2 : 0) +
          (advancedHint ? -1 : 0) +
          (headlessPreferred && headlessHint ? 1 : 0);

        const actionScores =
          actions.length > 0
            ? actions
                .map((a) => ({
                  action: a,
                  score: tokenize(a).filter((t) => queryTokens.has(t)).length,
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 3)
            : [];

        return {
          tool: def.name,
          score,
          matchedTokens: uniqueStrings(match).slice(0, 10),
          actions: actionScores.filter((a) => a.score > 0),
        };
      })
        .sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool))
        .slice(0, limit);

      return {
        ok: true,
        summary: 'Tool search results',
        details: {
          query,
          limit,
          suggestions: [
            'Call meta_tool_manager(action="tool_help", tool=..., toolAction=...) for the top match before calling a multi-action manager tool.',
          ],
          candidates,
        },
        logs: [],
      };
    },

    godot_tool_help: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const tool = asNonEmptyString(argsObj.tool, 'tool');
      const actionRaw = argsObj.action;
      const action =
        typeof actionRaw === 'string' && actionRaw.trim().length > 0
          ? actionRaw.trim()
          : null;

      const def = ALL_TOOL_DEFINITIONS.find((t) => t.name === tool) ?? null;
      if (!def) {
        return {
          ok: false,
          summary: `Unknown tool: ${tool}`,
          error: {
            code: 'E_NOT_FOUND',
            message: `Unknown tool: ${tool}`,
            details: { tool },
            retryable: true,
            suggestedFix:
              'Call meta_tool_manager(action="server_info") to list tools, then retry.',
          },
          details: { tool },
          logs: [],
        };
      }

      const actionEnum = getActionEnum(def);
      const hasAction = actionEnum.length > 0;
      if (action && hasAction && !actionEnum.includes(action)) {
        return {
          ok: false,
          summary: `Unknown action "${action}" for tool "${tool}"`,
          error: {
            code: 'E_SCHEMA_VALIDATION',
            message: `Unknown action "${action}" for tool "${tool}"`,
            details: { tool, action, supportedActions: actionEnum },
            retryable: true,
            suggestedFix: 'Use a supported action or omit action.',
          },
          details: { tool, action, supportedActions: actionEnum },
          logs: [],
        };
      }

      const baseSchema = isRecord(def.inputSchema) ? def.inputSchema : null;
      const schemaForHelp =
        action && hasAction ? getActionBranchSchema(def, action) : baseSchema;

      if (!schemaForHelp) {
        throw new ValidationError(
          'tool',
          `Tool schema missing for ${tool}`,
          valueType(def.inputSchema),
        );
      }

      const required = schemaRequiredKeys(schemaForHelp);
      const props = schemaProperties(schemaForHelp);
      const optional = Object.keys(props).filter((k) => !required.includes(k));

      const examples: Array<{ tool: string; args: Record<string, unknown> }> =
        [];
      if (action && hasAction) {
        examples.push({
          tool,
          args: { action, ...buildExampleArgs(schemaForHelp) },
        });
      } else if (hasAction) {
        const first = actionEnum[0] ?? null;
        if (first) {
          const branch = getActionBranchSchema(def, first) ?? schemaForHelp;
          examples.push({
            tool,
            args: { action: first, ...buildExampleArgs(branch) },
          });
        }
      } else {
        examples.push({ tool, args: buildExampleArgs(schemaForHelp) });
      }

      const toolAnnotations =
        def.annotations &&
        typeof def.annotations === 'object' &&
        !Array.isArray(def.annotations)
          ? (def.annotations as Record<string, unknown>)
          : {};

      const actionAnnotations = hasAction
        ? Object.fromEntries(
            actionEnum
              .map((a) => [a, inferActionAnnotations(tool, a)])
              .filter(([, v]) => Boolean(v)),
          )
        : {};

      return {
        ok: true,
        summary: 'Tool help',
        details: {
          tool,
          ...(action ? { action } : {}),
          description: def.description ?? '',
          ...(hasAction ? { supportedActions: actionEnum } : {}),
          annotations: {
            tool: toolAnnotations,
            ...(hasAction && action
              ? { action: inferActionAnnotations(tool, action) }
              : {}),
            ...(hasAction && !action ? { actions: actionAnnotations } : {}),
          },
          schema: {
            required,
            optional,
          },
          examples,
        },
        logs: [],
      };
    },
  };
}
