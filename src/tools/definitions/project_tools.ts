import type { ToolDefinition } from './tool_definition.js';

export const PROJECT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'launch_editor',
    description: 'Launch Godot editor for a specific project',
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
        token: {
          type: 'string',
          description: 'Optional: editor bridge token override',
        },
        port: {
          type: 'number',
          description: 'Optional: editor bridge port override',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'run_project',
    description: 'Run the Godot project and capture output',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        headless: {
          type: 'boolean',
          description:
            'Optional: run with --headless (no GUI/window; recommended for CI)',
        },
        scene: {
          type: 'string',
          description: 'Optional: Specific scene to run',
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
    name: 'get_debug_output',
    description: 'Get the current debug output and errors',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'stop_project',
    description: 'Stop the currently running Godot project',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_godot_version',
    description: 'Get the installed Godot version',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'godot_sync_addon',
    description:
      'Sync the editor bridge addon into a Godot project and optionally enable the plugin',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        enablePlugin: {
          type: 'boolean',
          description: 'Optional: enable editor plugin (default: true)',
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
    name: 'get_project_info',
    description: 'Retrieve metadata about a Godot project',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'godot_preflight',
    description:
      'Run lightweight environment checks for a Godot project (project file, addon, port, optional Godot path).',
    inputSchema: {
      type: 'object',
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
  {
    name: 'add_node',
    description: 'Add a node to an existing scene',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        scenePath: {
          type: 'string',
          description: 'Path to the scene file (relative to project)',
        },
        parentNodePath: {
          type: 'string',
          description: 'Parent node path (default: root)',
        },
        nodeType: { type: 'string', description: 'Node type to add' },
        nodeName: { type: 'string', description: 'Name of the new node' },
        properties: {
          type: 'object',
          description: 'Optional properties to set on the node',
        },
      },
      required: ['projectPath', 'scenePath', 'nodeType', 'nodeName'],
    },
  },
  {
    name: 'load_sprite',
    description: 'Load a sprite into a Sprite2D node',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        scenePath: {
          type: 'string',
          description: 'Path to the scene file (relative to project)',
        },
        nodePath: { type: 'string', description: 'Path to the Sprite2D node' },
        texturePath: {
          type: 'string',
          description: 'Path to the texture file (relative to project)',
        },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'texturePath'],
    },
  },
  {
    name: 'save_scene',
    description: 'Save a scene (optionally as a new file)',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        scenePath: {
          type: 'string',
          description: 'Path to the scene file (relative to project)',
        },
        newPath: {
          type: 'string',
          description:
            'Optional: New path to save the scene as (relative to project)',
        },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'get_uid',
    description: 'Get UID for a file (Godot 4.4+)',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        filePath: {
          type: 'string',
          description: 'Path to the file (relative to project)',
        },
      },
      required: ['projectPath', 'filePath'],
    },
  },
];
