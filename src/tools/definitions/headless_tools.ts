import type { ToolDefinition } from './tool_definition.js';

export const HEADLESS_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'godot_headless_op',
    description:
      'Run a headless Godot operation (godot_operations.gd) inside a project.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        operation: { type: 'string', description: 'Operation name' },
        params: {
          description: 'JSON parameters (object) or a JSON string',
          anyOf: [{ type: 'object' }, { type: 'string' }],
          default: {},
        },
      },
      required: ['projectPath', 'operation'],
    },
    annotations: {
      destructiveHint: true,
      headlessHint: true,
      advancedHint: true,
    },
  },
  {
    name: 'godot_headless_batch',
    description: 'Run multiple headless operations in one Godot process.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        steps: {
          type: 'array',
          description: 'Batch steps to execute in-order',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              operation: { type: 'string', description: 'Operation name' },
              params: {
                description: 'JSON parameters (object) or a JSON string',
                anyOf: [{ type: 'object' }, { type: 'string' }],
              },
            },
            required: ['operation'],
          },
        },
        stopOnError: {
          type: 'boolean',
          description: 'Stop when a step fails (default: true)',
          default: true,
        },
      },
      required: ['projectPath', 'steps'],
    },
    annotations: {
      destructiveHint: true,
      headlessHint: true,
      advancedHint: true,
    },
  },
];
