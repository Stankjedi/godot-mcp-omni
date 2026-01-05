import type { ToolDefinition } from './tool_definition.js';

export const PROJECT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_debug_output',
    description: 'Get the current debug output and errors',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'get_godot_version',
    description: 'Get the installed Godot version',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'godot_sync_addon',
    description:
      'Sync the editor bridge addon into a Godot project and optionally enable the plugin',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        enablePlugin: {
          type: 'boolean',
          description: 'Optional: enable editor plugin (default: true)',
        },
        ensureToken: {
          type: 'boolean',
          description:
            'Optional: create/update <project>/.godot_mcp_token if missing/empty (default: true).',
        },
        token: {
          type: 'string',
          description:
            'Optional: explicit token string. Only used when ensureToken=true; never returned in outputs.',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'godot_import_project_assets',
    description:
      'Run a headless import step for project assets (useful for SVG/UID workflows)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        godotPath: {
          type: 'string',
          description: 'Optional: path to Godot executable',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'list_projects',
    description: 'List Godot projects in a directory',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        directory: {
          type: 'string',
          description: 'Directory to search for Godot projects',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to search recursively (default: false)',
        },
        maxDepth: {
          type: 'number',
          description:
            'Optional: maximum recursion depth when recursive=true (1 = only direct children)',
        },
        ignoreDirs: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional: override ignore list for recursive scanning (default ignores common heavy dirs)',
        },
      },
      required: ['directory'],
    },
  },
  {
    name: 'godot_preflight',
    description:
      'Run lightweight environment checks for a Godot project (project file, addon, port, optional Godot path).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        godotPath: {
          type: 'string',
          description:
            'Optional: path to Godot executable (overrides GODOT_PATH)',
        },
        host: {
          type: 'string',
          description: 'Optional: editor bridge host (default: 127.0.0.1)',
        },
        port: {
          type: 'number',
          description: 'Optional: editor bridge port (default: 8765)',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'create_scene',
    description: 'Create a new Godot scene file',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        scenePath: {
          type: 'string',
          description:
            'Path where the scene file will be created (relative to project)',
        },
        rootNodeType: {
          type: 'string',
          description: 'Root node type (default: Node2D)',
        },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
];
