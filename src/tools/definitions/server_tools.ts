import type { ToolDefinition } from './tool_definition.js';

export const SERVER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'server_info',
    description:
      'Return server metadata and safety defaults (CI-safe; no Godot required).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
      required: [],
    },
  },
];
