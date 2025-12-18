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
import { ValidationError } from './validation.js';

import { createEditorToolHandlers } from './tools/editor.js';
import { createHeadlessToolHandlers } from './tools/headless.js';
import { createProjectToolHandlers } from './tools/project.js';

import type { EditorBridgeClient } from './editor_bridge_client.js';
import type { ServerContext } from './tools/context.js';
import type { GodotProcess, ToolHandler, ToolResponse } from './tools/types.js';

const DEBUG_MODE = process.env.DEBUG === 'true';

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

function toMcpResponse(result: ToolResponse): any {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'godot_headless_op',
    description: 'Run a headless Godot operation (godot_operations.gd) inside a project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
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
    name: 'godot_connect_editor',
    description: 'Connect to an in-editor bridge plugin (addons/godot_mcp_bridge) via TCP.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        godotPath: { type: 'string', description: 'Optional: path to Godot executable' },
        token: { type: 'string', description: 'Optional: auth token' },
        host: { type: 'string', description: 'Optional: host (default 127.0.0.1)' },
        port: { type: 'number', description: 'Optional: port (default 8765)' },
        timeoutMs: { type: 'number', description: 'Optional: connect/hello timeout in ms (default: 30000)' },
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
          description: 'Either an object or a JSON string (must include method and optional params).',
          anyOf: [{ type: 'object' }, { type: 'string' }],
        },
        timeoutMs: { type: 'number', description: 'Optional: RPC timeout in ms (default: 10000)' },
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
          description: 'Either an object or a JSON string (class_name or node_path or instance_id).',
          anyOf: [{ type: 'object' }, { type: 'string' }],
        },
        timeoutMs: { type: 'number', description: 'Optional: RPC timeout in ms (default: 10000)' },
      },
      required: ['query_json'],
    },
  },
  {
    name: 'launch_editor',
    description: 'Launch Godot editor for a specific project',
    inputSchema: {
      type: 'object',
      properties: { projectPath: { type: 'string', description: 'Path to the Godot project directory' } },
      required: ['projectPath'],
    },
  },
  {
    name: 'run_project',
    description: 'Run the Godot project and capture output',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scene: { type: 'string', description: 'Optional: Specific scene to run' },
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
    name: 'list_projects',
    description: 'List Godot projects in a directory',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory to search for Godot projects' },
        recursive: { type: 'boolean', description: 'Whether to search recursively (default: false)' },
      },
      required: ['directory'],
    },
  },
  {
    name: 'get_project_info',
    description: 'Retrieve metadata about a Godot project',
    inputSchema: {
      type: 'object',
      properties: { projectPath: { type: 'string', description: 'Path to the Godot project directory' } },
      required: ['projectPath'],
    },
  },
  {
    name: 'create_scene',
    description: 'Create a new Godot scene file',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Path where the scene file will be created (relative to project)' },
        rootNodeType: { type: 'string', description: 'Root node type (default: Node2D)' },
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
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Path to the scene file (relative to project)' },
        parentNodePath: { type: 'string', description: 'Parent node path (default: root)' },
        nodeType: { type: 'string', description: 'Node type to add' },
        nodeName: { type: 'string', description: 'Name of the new node' },
        properties: { type: 'object', description: 'Optional properties to set on the node' },
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
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Path to the scene file (relative to project)' },
        nodePath: { type: 'string', description: 'Path to the Sprite2D node' },
        texturePath: { type: 'string', description: 'Path to the texture file (relative to project)' },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'texturePath'],
    },
  },
  {
    name: 'export_mesh_library',
    description: 'Export a 3D scene as a MeshLibrary resource for GridMap',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Path to the 3D scene file (relative to project)' },
        outputPath: { type: 'string', description: 'Path where the MeshLibrary resource will be saved (relative to project)' },
        meshItemNames: { type: 'array', items: { type: 'string' }, description: 'Optional: Names of mesh items to include (default: all)' },
      },
      required: ['projectPath', 'scenePath', 'outputPath'],
    },
  },
  {
    name: 'save_scene',
    description: 'Save a scene (optionally as a new file)',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Path to the scene file (relative to project)' },
        newPath: { type: 'string', description: 'Optional: New path to save the scene as (relative to project)' },
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
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        filePath: { type: 'string', description: 'Path to the file (relative to project)' },
      },
      required: ['projectPath', 'filePath'],
    },
  },
  {
    name: 'update_project_uids',
    description: 'Update UID references in a Godot project by resaving resources (Godot 4.4+)',
    inputSchema: {
      type: 'object',
      properties: { projectPath: { type: 'string', description: 'Path to the Godot project directory' } },
      required: ['projectPath'],
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
    this.operationsScriptPath = path.join(__dirname, 'scripts', 'godot_operations.gd');

    this.server = new Server(
      { name: 'godot-mcp-omni', version: '0.1.0' },
      { capabilities: { tools: {} } }
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

  private normalizeParameters(params: any): any {
    if (!params || typeof params !== 'object') return params;
    if (Array.isArray(params)) return params.map((v) => this.normalizeParameters(v));

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      const mapped = this.parameterMappings[key] ?? key;
      result[mapped] = this.normalizeParameters(value);
    }
    return result;
  }

  private convertCamelToSnakeCase(params: any): any {
    if (!params || typeof params !== 'object') return params;
    if (Array.isArray(params)) return params.map((v) => this.convertCamelToSnakeCase(v));

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
    if (!p || p.includes('..')) throw new Error('Invalid path (contains "..")');
  }

  private assertValidProject(projectPath: string): void {
    this.ensureNoTraversal(projectPath);
    if (!existsSync(projectPath)) {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }
    const projectFile = path.join(projectPath, 'project.godot');
    if (!existsSync(projectFile)) {
      throw new Error(`Not a valid Godot project (missing project.godot): ${projectPath}`);
    }
  }

  private async ensureGodotPath(customGodotPath?: string): Promise<string> {
    const candidate = await detectGodotPath({
      godotPath: customGodotPath ?? this.godotPath ?? undefined,
      strictPathValidation: this.strictPathValidation,
      debug: (m) => this.logDebug(m),
    });

    this.godotPath = candidate;
    const ok = await isValidGodotPath(candidate, this.validatedGodotPathCache, (m) =>
      this.logDebug(m)
    );

    if (!ok && this.strictPathValidation) throw new Error(`Invalid Godot path: ${candidate}`);
    if (!ok) console.warn(`[SERVER] Warning: using potentially invalid Godot path: ${candidate}`);
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
    };

    return {
      ...createHeadlessToolHandlers(ctx),
      ...createEditorToolHandlers(ctx),
      ...createProjectToolHandlers(ctx),
    };
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOL_DEFINITIONS as unknown as any[],
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
          const anyError = error as any;
          const errorDetails: Record<string, unknown> = { name: error.name, message };
          if (anyError?.code !== undefined) errorDetails.code = anyError.code;
          if (Array.isArray(anyError?.attemptedCandidates)) {
            errorDetails.attemptedCandidates = anyError.attemptedCandidates;
          }
          details.error = errorDetails;
        } else {
          details.error = { message };
        }

        result = { ok: false, summary: message, details, logs: [] };
      }

      const maybeProjectPath = (args as any)?.projectPath;
      const auditProjectPath =
        typeof maybeProjectPath === 'string' && maybeProjectPath.length > 0
          ? maybeProjectPath
          : tool === 'godot_rpc' || tool === 'godot_inspect'
          ? this.editorProjectPath
          : tool === 'get_debug_output' || tool === 'stop_project'
          ? this.activeProcess?.projectPath ?? null
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
            error: redactSecrets((result.details as any)?.error),
          });
        } catch (error) {
          this.logDebug(`Audit log failed: ${String(error)}`);
        }
      }

      return toMcpResponse(result);
    });
  }

  private async dispatchTool(tool: string, args: any): Promise<ToolResponse> {
    const handler = this.toolHandlers[tool];
    if (!handler) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${tool}`);

    try {
      return await handler(args);
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

