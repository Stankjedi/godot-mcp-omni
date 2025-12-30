import type { ToolDefinition } from './tool_definition.js';

export const EDITOR_RPC_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'godot_connect_editor',
    description:
      'Connect to an in-editor bridge plugin (addons/godot_mcp_bridge) via TCP.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        godotPath: {
          type: 'string',
          description: 'Optional: path to Godot executable',
        },
        token: { type: 'string', description: 'Optional: auth token' },
        host: {
          type: 'string',
          description: 'Optional: host (default 127.0.0.1)',
        },
        port: { type: 'number', description: 'Optional: port (default 8765)' },
        timeoutMs: {
          type: 'number',
          description: 'Optional: connect/hello timeout in ms (default: 30000)',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'godot_rpc',
    description: 'Send an RPC request to the connected editor bridge.',
    inputSchema: {
      type: 'object',
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
  },
  {
    name: 'godot_inspect',
    description: 'Reflection/introspection helpers over the editor bridge.',
    inputSchema: {
      type: 'object',
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
  },
  {
    name: 'godot_editor_batch',
    description:
      'Run multiple editor-bridge RPC calls as one undoable batch (atomic).',
    inputSchema: {
      type: 'object',
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
  },
  {
    name: 'godot_select_node',
    description: 'Select/focus a node in the editor scene tree.',
    inputSchema: {
      type: 'object',
      properties: {
        nodePath: {
          type: 'string',
          description: 'Node path relative to edited scene root (e.g., "root")',
        },
        instanceId: {
          description: 'Optional: node instance ID (number or integer string)',
          anyOf: [{ type: 'number' }, { type: 'string' }],
        },
        additive: {
          type: 'boolean',
          description: 'Add to selection instead of replacing it',
          default: false,
        },
        clear: {
          type: 'boolean',
          description: 'Clear selection (ignores nodePath/instanceId)',
          default: false,
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional: RPC timeout in ms (default: 10000)',
        },
      },
    },
  },
  {
    name: 'godot_scene_tree_query',
    description:
      'Query nodes in the edited scene by name/class/group (returns node paths + instance IDs + unique names).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact node name match' },
        nameContains: {
          type: 'string',
          description: 'Substring match on node name',
        },
        className: {
          type: 'string',
          description: 'Class filter (Node.is_class)',
        },
        group: {
          type: 'string',
          description: 'Group filter (Node.is_in_group)',
        },
        includeRoot: {
          type: 'boolean',
          description: 'Include the edited scene root in search',
          default: false,
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 50)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional: RPC timeout in ms (default: 10000)',
        },
      },
    },
  },
  {
    name: 'godot_duplicate_node',
    description: 'Duplicate a node in the edited scene (undoable).',
    inputSchema: {
      type: 'object',
      properties: {
        nodePath: {
          type: 'string',
          description: 'Node path (relative to root)',
        },
        newName: { type: 'string', description: 'Optional: new node name' },
        timeoutMs: {
          type: 'number',
          description: 'Optional: RPC timeout in ms (default: 10000)',
        },
      },
      required: ['nodePath'],
    },
  },
  {
    name: 'godot_reparent_node',
    description: 'Reparent a node in the edited scene (undoable).',
    inputSchema: {
      type: 'object',
      properties: {
        nodePath: {
          type: 'string',
          description: 'Node path (relative to root)',
        },
        newParentPath: {
          type: 'string',
          description: 'New parent node path (relative to root)',
        },
        index: {
          type: 'number',
          description:
            'Optional: new child index under the new parent (0 allowed)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional: RPC timeout in ms (default: 10000)',
        },
      },
      required: ['nodePath', 'newParentPath'],
    },
  },
  {
    name: 'godot_add_scene_instance',
    description: 'Instance a PackedScene into the edited scene (undoable).',
    inputSchema: {
      type: 'object',
      properties: {
        scenePath: {
          type: 'string',
          description: 'Path to a PackedScene (res://... or inside project)',
        },
        parentNodePath: {
          type: 'string',
          description: 'Parent node path (default: root)',
        },
        name: { type: 'string', description: 'Optional: instance node name' },
        props: {
          type: 'object',
          description: 'Optional: properties to set on the instance root',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional: RPC timeout in ms (default: 10000)',
        },
      },
      required: ['scenePath'],
    },
  },
  {
    name: 'godot_disconnect_signal',
    description:
      'Disconnect a signal connection in the edited scene (undoable).',
    inputSchema: {
      type: 'object',
      properties: {
        fromNodePath: { type: 'string', description: 'Emitter node path' },
        signal: { type: 'string', description: 'Signal name' },
        toNodePath: { type: 'string', description: 'Target node path' },
        method: { type: 'string', description: 'Target method name' },
        timeoutMs: {
          type: 'number',
          description: 'Optional: RPC timeout in ms (default: 10000)',
        },
      },
      required: ['fromNodePath', 'signal', 'toNodePath', 'method'],
    },
  },
];
