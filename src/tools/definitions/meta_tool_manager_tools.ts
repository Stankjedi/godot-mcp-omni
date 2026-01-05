import type { ToolDefinition } from './tool_definition.js';
import { actionOneOfSchema, strictObjectSchema } from './schema.js';

export const META_TOOL_MANAGER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'meta_tool_manager',
    description:
      'Unified wrapper for MCP meta tools (server_info/tool_search/tool_help).',
    inputSchema: {
      ...(() => {
        const props = {
          query: { type: 'string', description: 'What you want to do.' },
          limit: {
            type: 'number',
            description: 'Max candidates to return (default: 5).',
          },
          context: strictObjectSchema({
            description:
              'Optional runtime context (best-effort; used for ranking only).',
            properties: {
              editorConnected: { type: 'boolean' },
              headlessPreferred: { type: 'boolean' },
              projectPath: { type: 'string' },
            },
          }),
          tool: { type: 'string', description: 'Tool name (required).' },
          toolAction: {
            type: 'string',
            description:
              'Optional action name (for multi-action manager tools like godot_scene_manager).',
          },
        };

        const commonOptional = ['limit', 'context'];

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional,
          variants: [
            { action: 'server_info', required: [], optional: [] },
            {
              action: 'tool_search',
              required: ['query'],
              optional: ['limit', 'context'],
            },
            {
              action: 'tool_help',
              required: ['tool'],
              optional: ['toolAction'],
            },
          ],
        });
      })(),
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      managerHint: true,
    },
  },
];
