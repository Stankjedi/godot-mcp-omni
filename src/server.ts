import { fileURLToPath } from 'url';
import path from 'path';
import { existsSync } from 'fs';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { detectGodotPath, isValidGodotPath } from './godot_cli.js';
import { appendAuditLog, redactSecrets } from './security.js';
import { ValidationError, hasTraversalSegment } from './validation.js';

import { createEditorToolHandlers } from './tools/editor.js';
import { createHeadlessToolHandlers } from './tools/headless.js';
import { createProjectToolHandlers } from './tools/project.js';
import { createUnifiedToolHandlers } from './tools/unified.js';

import type { EditorBridgeClient } from './editor_bridge_client.js';
import type { ServerContext } from './tools/context.js';
import type { GodotProcess, ToolHandler, ToolResponse } from './tools/types.js';

const DEBUG_MODE = process.env.DEBUG === 'true';

type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpToolResponse = {
  content: { type: 'text'; text: string }[];
  isError: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

export interface GodotMcpOmniServerConfig {
  godotPath?: string;
  strictPathValidation?: boolean;
}

function invalidArgs(tool: string, error: unknown): ToolResponse | null {
  if (!(error instanceof ValidationError)) return null;
  return {
    ok: false,
    summary: `Invalid arguments: ${error.message}`,
    details: { tool, field: error.field, receivedType: error.receivedType },
    logs: [],
  };
}

function toMcpResponse(result: ToolResponse): McpToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'godot_headless_op',
    description:
      'Run a headless Godot operation (godot_operations.gd) inside a project.',
    inputSchema: {
      type: 'object',
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
  },
  {
    name: 'godot_headless_batch',
    description: 'Run multiple headless operations in one Godot process.',
    inputSchema: {
      type: 'object',
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
  },
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
  {
    name: 'godot_scene_manager',
    description:
      'Unified scene/node editing tool (multi-action; uses editor bridge when connected, otherwise headless when possible).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'create',
            'duplicate',
            'reparent',
            'instance',
            'remove',
            'undo',
            'redo',
          ],
        },
        projectPath: { type: 'string', description: 'Required for headless create' },
        scenePath: { type: 'string', description: 'Required for headless create' },
        nodeType: { type: 'string' },
        nodeName: { type: 'string' },
        parentNodePath: { type: 'string' },
        nodePath: { type: 'string' },
        newName: { type: 'string' },
        newParentPath: { type: 'string' },
        index: { type: 'number' },
        props: { type: 'object' },
        timeoutMs: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'godot_inspector_manager',
    description:
      'Unified inspector/query tool (multi-action; uses editor bridge; connect_signal supports headless fallback when projectPath+scenePath provided).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'query',
            'inspect',
            'select',
            'connect_signal',
            'disconnect_signal',
            'property_list',
          ],
        },
        // Common editor args
        timeoutMs: { type: 'number' },
        // query
        name: { type: 'string' },
        nameContains: { type: 'string' },
        className: { type: 'string' },
        group: { type: 'string' },
        includeRoot: { type: 'boolean' },
        limit: { type: 'number' },
        // inspect/property_list
        query_json: { anyOf: [{ type: 'object' }, { type: 'string' }] },
        nodePath: { type: 'string' },
        instanceId: { anyOf: [{ type: 'number' }, { type: 'string' }] },
        // select
        additive: { type: 'boolean' },
        clear: { type: 'boolean' },
        // signals
        fromNodePath: { type: 'string' },
        toNodePath: { type: 'string' },
        signal: { type: 'string' },
        method: { type: 'string' },
        // headless fallback for connect_signal
        projectPath: { type: 'string' },
        scenePath: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'godot_asset_manager',
    description:
      'Unified asset/resource tool (multi-action; combines UID, headless load_texture, and editor filesystem scan/reimport with headless import fallback).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['load_texture', 'get_uid', 'scan', 'reimport', 'auto_import_check'],
        },
        projectPath: { type: 'string' },
        // load_texture (headless load_sprite wrapper)
        scenePath: { type: 'string' },
        nodePath: { type: 'string' },
        texturePath: { type: 'string' },
        // get_uid
        filePath: { type: 'string' },
        // scan/reimport
        files: { type: 'array', items: { type: 'string' } },
        paths: { type: 'array', items: { type: 'string' } },
        forceReimport: { type: 'boolean' },
      },
      required: ['action'],
    },
  },
  {
    name: 'godot_workspace_manager',
    description:
      'Unified workspace tool (multi-action; launches/connects editor, runs/stops/restarts via editor when connected otherwise headless run_project).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['launch', 'connect', 'run', 'stop', 'open_scene', 'save_all', 'restart'],
        },
        mode: {
          type: 'string',
          description: 'Optional: "auto" (default) or "headless"',
        },
        projectPath: { type: 'string' },
        godotPath: { type: 'string' },
        token: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number' },
        timeoutMs: { type: 'number' },
        scene: { type: 'string' },
        scenePath: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'godot_editor_view_manager',
    description:
      'Unified editor UI tool (multi-action; requires editor bridge).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['capture_viewport', 'switch_screen', 'edit_script', 'add_breakpoint'],
        },
        timeoutMs: { type: 'number' },
        maxSize: { type: 'number' },
        screenName: { type: 'string' },
        scriptPath: { type: 'string' },
        lineNumber: { type: 'number' },
      },
      required: ['action'],
    },
  },
] as const;

export class GodotMcpOmniServer {
  private server: Server;
  private activeProcess: GodotProcess | null = null;
  private godotPath: string | null = null;
  private operationsScriptPath: string;
  private strictPathValidation = false;
  private validatedGodotPathCache: Map<string, boolean> = new Map();

  private editorClient: EditorBridgeClient | null = null;
  private editorProjectPath: string | null = null;
  private editorLaunchInfo: { projectPath: string; ts: number } | null = null;
  private toolHandlers: Record<string, ToolHandler> = {};

  private parameterMappings: Record<string, string> = {
    project_path: 'projectPath',
    scene_path: 'scenePath',
    root_node_type: 'rootNodeType',
    parent_node_path: 'parentNodePath',
    node_type: 'nodeType',
    node_name: 'nodeName',
    texture_path: 'texturePath',
    node_path: 'nodePath',
    output_path: 'outputPath',
    mesh_item_names: 'meshItemNames',
    new_path: 'newPath',
    file_path: 'filePath',
    script_path: 'scriptPath',
    resource_path: 'resourcePath',
    class_name: 'className',
  };

  private reverseParameterMappings: Record<string, string> = {};

  constructor(config: GodotMcpOmniServerConfig = {}) {
    this.strictPathValidation = config.strictPathValidation === true;
    if (config.godotPath) this.godotPath = path.normalize(config.godotPath);

    for (const [snake, camel] of Object.entries(this.parameterMappings)) {
      this.reverseParameterMappings[camel] = snake;
    }

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    this.operationsScriptPath = path.join(
      __dirname,
      'scripts',
      'godot_operations.gd',
    );

    this.server = new Server(
      { name: 'godot-mcp-omni', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    this.toolHandlers = this.createToolHandlers();
    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);

    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private logDebug(message: string): void {
    if (DEBUG_MODE) console.debug(`[DEBUG] ${message}`);
  }

  private normalizeParameters(params: unknown): unknown {
    if (!params || typeof params !== 'object') return params;
    if (Array.isArray(params))
      return params.map((v) => this.normalizeParameters(v));

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      const mapped = this.parameterMappings[key] ?? key;
      result[mapped] = this.normalizeParameters(value);
    }
    return result;
  }

  private convertCamelToSnakeCase(params: unknown): unknown {
    if (!params || typeof params !== 'object') return params;
    if (Array.isArray(params))
      return params.map((v) => this.convertCamelToSnakeCase(v));

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      const snakeKey =
        this.reverseParameterMappings[key] ??
        key.replace(/[A-Z]/gu, (c) => `_${c.toLowerCase()}`);
      result[snakeKey] = this.convertCamelToSnakeCase(value);
    }
    return result;
  }

  private ensureNoTraversal(p: string): void {
    if (!p || p.trim().length === 0) throw new Error('Invalid path (empty)');
    if (hasTraversalSegment(p)) throw new Error('Invalid path (contains "..")');
  }

  private assertValidProject(projectPath: string): void {
    this.ensureNoTraversal(projectPath);
    if (!existsSync(projectPath)) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }
    const projectFile = path.join(projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      throw new Error(
        `Not a valid Godot project (missing project.godot): ${projectPath}`,
      );
    }
  }

  private async ensureGodotPath(customGodotPath?: string): Promise<string> {
    const candidate = await detectGodotPath({
      godotPath: customGodotPath ?? this.godotPath ?? undefined,
      strictPathValidation: this.strictPathValidation,
      debug: (m) => this.logDebug(m),
    });

    this.godotPath = candidate;
    const ok = await isValidGodotPath(
      candidate,
      this.validatedGodotPathCache,
      (m) => this.logDebug(m),
    );

    if (!ok && this.strictPathValidation)
      throw new Error(`Invalid Godot path: ${candidate}`);
    if (!ok)
      console.warn(
        `[SERVER] Warning: using potentially invalid Godot path: ${candidate}`,
      );
    return candidate;
  }

  private createToolHandlers(): Record<string, ToolHandler> {
    const ctx: ServerContext = {
      logDebug: (m) => this.logDebug(m),
      assertValidProject: (p) => this.assertValidProject(p),
      ensureNoTraversal: (p) => this.ensureNoTraversal(p),
      ensureGodotPath: (p) => this.ensureGodotPath(p),
      convertCamelToSnakeCase: (p) => this.convertCamelToSnakeCase(p),
      operationsScriptPath: this.operationsScriptPath,

      getActiveProcess: () => this.activeProcess,
      setActiveProcess: (proc) => {
        this.activeProcess = proc;
      },

      getEditorClient: () => this.editorClient,
      setEditorClient: (client) => {
        if (this.editorClient && this.editorClient !== client) {
          this.editorClient.close();
        }
        this.editorClient = client;
      },
      getEditorProjectPath: () => this.editorProjectPath,
      setEditorProjectPath: (projectPath) => {
        this.editorProjectPath = projectPath;
      },
      getEditorLaunchInfo: () => this.editorLaunchInfo,
      setEditorLaunchInfo: (info) => {
        this.editorLaunchInfo = info;
      },
    };

    const headlessHandlers = createHeadlessToolHandlers(ctx);
    const editorHandlers = createEditorToolHandlers(ctx);
    const projectHandlers = createProjectToolHandlers(ctx);

    const unifiedHandlers = createUnifiedToolHandlers(ctx, {
      ...headlessHandlers,
      ...editorHandlers,
      ...projectHandlers,
    });

    return {
      ...headlessHandlers,
      ...editorHandlers,
      ...projectHandlers,
      ...unifiedHandlers,
    };
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOL_DEFINITIONS as unknown as ToolDefinition[],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = request.params.name;
      const args = this.normalizeParameters(request.params.arguments ?? {});

      let result: ToolResponse;
      try {
        result = await this.dispatchTool(tool, args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details: Record<string, unknown> = { tool };

        if (error instanceof Error) {
          const errorDetails: Record<string, unknown> = {
            name: error.name,
            message,
          };
          if (isRecord(error)) {
            const errorRecord = error as Record<string, unknown>;
            if (errorRecord.code !== undefined)
              errorDetails.code = errorRecord.code;
            if (Array.isArray(errorRecord.attemptedCandidates)) {
              errorDetails.attemptedCandidates =
                errorRecord.attemptedCandidates;
            }
          }
          details.error = errorDetails;
        } else {
          details.error = { message };
        }

        result = { ok: false, summary: message, details, logs: [] };
      }

      const maybeProjectPath = getStringField(args, 'projectPath');
      const auditProjectPath =
        typeof maybeProjectPath === 'string' && maybeProjectPath.length > 0
          ? maybeProjectPath
          : tool === 'godot_rpc' || tool === 'godot_inspect'
            ? this.editorProjectPath
            : tool === 'get_debug_output' || tool === 'stop_project'
              ? (this.activeProcess?.projectPath ?? null)
              : null;

      if (typeof auditProjectPath === 'string' && auditProjectPath.length > 0) {
        try {
          appendAuditLog(auditProjectPath, {
            ts: new Date().toISOString(),
            tool,
            args: redactSecrets(args),
            ok: Boolean(result.ok),
            summary: String(result.summary ?? ''),
            details: redactSecrets(result.details),
            error: redactSecrets(
              isRecord(result.details) ? result.details.error : undefined,
            ),
          });
        } catch (error) {
          this.logDebug(`Audit log failed: ${String(error)}`);
        }
      }

      return toMcpResponse(result);
    });
  }

  private async dispatchTool(
    tool: string,
    args: unknown,
  ): Promise<ToolResponse> {
    const handler = this.toolHandlers[tool];
    if (!handler)
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${tool}`);

    try {
      return await handler(args as Record<string, unknown>);
    } catch (error) {
      const invalid = invalidArgs(tool, error);
      if (invalid) return invalid;
      throw error;
    }
  }

  private async cleanup(): Promise<void> {
    if (this.activeProcess) {
      this.activeProcess.process.kill();
      this.activeProcess = null;
    }
    this.editorClient?.close();
    this.editorClient = null;
    await this.server.close();
  }

  async run(): Promise<void> {
    await this.ensureGodotPath();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('godot-mcp-omni server running on stdio');
  }
}
