import type { ToolDefinition } from './tool_definition.js';

export const EDITOR_RPC_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'godot_rpc',
    description: 'Send an RPC request to the connected editor bridge.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        request_json: {
          description:
            'Either an object or a JSON string (must include method and optional params).',
          anyOf: [{ type: 'object' }, { type: 'string' }],
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional: RPC timeout in ms (default: 10000)',
        },
      },
      required: ['request_json'],
    },
    annotations: { destructiveHint: true, advancedHint: true },
  },
  {
    name: 'godot_inspect',
    description: 'Reflection/introspection helpers over the editor bridge.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query_json: {
          description:
            'Either an object or a JSON string (class_name or node_path or instance_id).',
          anyOf: [{ type: 'object' }, { type: 'string' }],
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional: RPC timeout in ms (default: 10000)',
        },
      },
      required: ['query_json'],
    },
    annotations: { readOnlyHint: true, advancedHint: true },
  },
  {
    name: 'godot_editor_batch',
    description:
      'Run multiple editor-bridge RPC calls as one undoable batch (atomic).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        actionName: {
          type: 'string',
          description: 'Optional: Undo/Redo action name',
        },
        stopOnError: {
          type: 'boolean',
          description:
            'Stop on first failed step (default: true). When any step fails, the batch is rolled back.',
          default: true,
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional: per-step RPC timeout in ms (default: 10000)',
        },
        steps: {
          type: 'array',
          description: 'Batch steps to execute in-order',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              method: { type: 'string', description: 'Editor RPC method name' },
              params: {
                description: 'JSON parameters (object) or a JSON string',
                anyOf: [{ type: 'object' }, { type: 'string' }],
                default: {},
              },
            },
            required: ['method'],
          },
        },
      },
      required: ['steps'],
    },
    annotations: { destructiveHint: true, advancedHint: true },
  },
];
