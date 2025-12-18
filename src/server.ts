import { fileURLToPath } from 'url';
import path from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { spawn } from 'child_process';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { detectGodotPath, execGodot, isValidGodotPath } from './godot_cli.js';
import { executeHeadlessOperation } from './headless_ops.js';
import { EditorBridgeClient } from './editor_bridge_client.js';
import {
  appendAuditLog,
  assertDangerousOpsAllowed,
  assertEditorRpcAllowed,
  redactSecrets,
  resolveInsideProject,
} from './security.js';

const DEBUG_MODE = process.env.DEBUG === 'true';
const GODOT_DEBUG_MODE = true;

export interface ToolResponse {
  ok: boolean;
  summary: string;
  details?: Record<string, unknown>;
  logs?: string[];
}

interface GodotProcess {
  process: any;
  output: string[];
  errors: string[];
  projectPath?: string;
}

export interface GodotMcpOmniServerConfig {
  godotPath?: string;
  strictPathValidation?: boolean;
}

function toMcpResponse(result: ToolResponse): any {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

function parseJsonish(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const trimmed = input.trim();
  if (!trimmed) return input;
  try {
    return JSON.parse(trimmed);
  } catch {
    return input;
  }
}

export class GodotMcpOmniServer {
  private server: Server;
  private activeProcess: GodotProcess | null = null;
  private godotPath: string | null = null;
  private operationsScriptPath: string;
  private strictPathValidation = false;
  private validatedGodotPathCache: Map<string, boolean> = new Map();

  private editorClient: EditorBridgeClient | null = null;
  private editorProjectPath: string | null = null;

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

  private isGodot44OrLater(versionText: string): boolean {
    const match = versionText.match(/(\d+)\.(\d+)/u);
    if (!match) return false;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (Number.isNaN(major) || Number.isNaN(minor)) return false;
    return major > 4 || (major === 4 && minor >= 4);
  }

  private findGodotProjects(directory: string, recursive: boolean): { path: string; name: string }[] {
    const projects: { path: string; name: string }[] = [];
    try {
      const entries = readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;

        const subdir = path.join(directory, entry.name);
        const projectFile = path.join(subdir, 'project.godot');
        if (existsSync(projectFile)) {
          projects.push({ path: subdir, name: entry.name });
          continue;
        }

        if (recursive) projects.push(...this.findGodotProjects(subdir, true));
      }
    } catch (error) {
      this.logDebug(`Error searching directory ${directory}: ${String(error)}`);
    }
    return projects;
  }

  private async getProjectStructureCounts(projectPath: string): Promise<Record<string, number>> {
    const structure = { scenes: 0, scripts: 0, assets: 0, other: 0 };

    const scanDirectory = (currentPath: string) => {
      const entries = readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const entryPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          scanDirectory(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;

        const ext = entry.name.split('.').pop()?.toLowerCase();
        if (ext === 'tscn') structure.scenes += 1;
        else if (ext === 'gd' || ext === 'gdscript' || ext === 'cs') structure.scripts += 1;
        else if (
          ['png', 'jpg', 'jpeg', 'webp', 'svg', 'ttf', 'wav', 'mp3', 'ogg'].includes(ext ?? '')
        ) {
          structure.assets += 1;
        } else {
          structure.other += 1;
        }
      }
    };

    try {
      scanDirectory(projectPath);
    } catch (error) {
      this.logDebug(`Error scanning project structure: ${String(error)}`);
    }

    return structure;
  }

  private validateHeadlessOpPaths(
    operation: string,
    params: Record<string, unknown>,
    projectPath: string
  ): void {
    const getString = (key: string): string | undefined => {
      const v = params[key];
      return typeof v === 'string' ? v : undefined;
    };

    const validate = (p?: string) => {
      if (!p) return;
      resolveInsideProject(projectPath, p);
    };

    const op = operation;

    if (
      op === 'create_scene' ||
      op === 'add_node' ||
      op === 'save_scene' ||
      op === 'set_node_properties' ||
      op === 'connect_signal' ||
      op === 'validate_scene'
    ) {
      validate(getString('scenePath') ?? getString('scene_path'));
    }

    if (op === 'load_sprite') {
      validate(getString('scenePath') ?? getString('scene_path'));
      validate(getString('texturePath') ?? getString('texture_path'));
    }

    if (op === 'export_mesh_library') {
      validate(getString('scenePath') ?? getString('scene_path'));
      validate(getString('outputPath') ?? getString('output_path'));
    }

    if (op === 'save_scene') validate(getString('newPath') ?? getString('new_path'));
    if (op === 'get_uid') validate(getString('filePath') ?? getString('file_path'));

    if (op === 'attach_script') {
      validate(getString('scenePath') ?? getString('scene_path'));
      validate(getString('scriptPath') ?? getString('script_path'));
    }

    if (op === 'create_script') validate(getString('scriptPath') ?? getString('script_path'));

    if (op === 'read_text_file' || op === 'write_text_file') validate(getString('path'));
    if (op === 'create_resource') validate(getString('resourcePath') ?? getString('resource_path'));
  }

  private async runHeadlessOp(
    operation: string,
    params: Record<string, unknown>,
    projectPath: string
  ): Promise<ToolResponse> {
    this.assertValidProject(projectPath);
    assertDangerousOpsAllowed(operation);
    this.validateHeadlessOpPaths(operation, params, projectPath);

    const godotPath = await this.ensureGodotPath();
    const snakeParams = this.convertCamelToSnakeCase(params) as Record<string, unknown>;

    const result = await executeHeadlessOperation({
      godotPath,
      projectPath,
      operationsScriptPath: this.operationsScriptPath,
      operation,
      params: snakeParams,
      godotDebugMode: GODOT_DEBUG_MODE,
      debug: (m) => this.logDebug(m),
    });

    const logs = [
      ...splitLines(result.stdout),
      ...splitLines(result.stderr).map((l) => `[stderr] ${l}`),
    ];

    if (result.parsed && typeof result.parsed.ok === 'boolean' && typeof result.parsed.summary === 'string') {
      return {
        ok: result.parsed.ok,
        summary: result.parsed.summary,
        details:
          (result.parsed.details as Record<string, unknown>) ??
          ({ operation, exitCode: result.exitCode } as Record<string, unknown>),
        logs: (Array.isArray(result.parsed.logs) ? result.parsed.logs : undefined) ?? logs,
      };
    }

    const ok = result.exitCode === 0;
    return {
      ok,
      summary: ok ? `${operation} succeeded` : `${operation} failed`,
      details: { operation, exitCode: result.exitCode },
      logs,
    };
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'godot_headless_op',
          description: 'Run a headless Godot operation (godot_operations.gd) inside a project.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
              operation: { type: 'string', description: 'Operation name' },
              params: { type: 'object', description: 'JSON parameters', default: {} },
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
                description: 'Either an object or a JSON string (class_name or node_path, or {method, params}).',
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
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
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
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
              scene: { type: 'string', description: 'Optional: Specific scene to run' },
            },
            required: ['projectPath'],
          },
        },
        { name: 'get_debug_output', description: 'Get the current debug output and errors', inputSchema: { type: 'object', properties: {}, required: [] } },
        { name: 'stop_project', description: 'Stop the currently running Godot project', inputSchema: { type: 'object', properties: {}, required: [] } },
        { name: 'get_godot_version', description: 'Get the installed Godot version', inputSchema: { type: 'object', properties: {}, required: [] } },
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
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
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
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
              scenePath: { type: 'string', description: 'Path where the scene file will be saved (relative to project)' },
              rootNodeType: { type: 'string', description: 'Type of the root node (e.g., Node2D, Node3D)', default: 'Node2D' },
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
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
            },
            required: ['projectPath'],
          },
        },
      ],
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
    switch (tool) {
      case 'godot_headless_op':
        return await this.handleGodotHeadlessOp(args);
      case 'godot_connect_editor':
        return await this.handleGodotConnectEditor(args);
      case 'godot_rpc':
        return await this.handleGodotRpc(args);
      case 'godot_inspect':
        return await this.handleGodotInspect(args);
      case 'launch_editor':
        return await this.handleLaunchEditor(args);
      case 'run_project':
        return await this.handleRunProject(args);
      case 'get_debug_output':
        return await this.handleGetDebugOutput();
      case 'stop_project':
        return await this.handleStopProject();
      case 'get_godot_version':
        return await this.handleGetGodotVersion();
      case 'list_projects':
        return await this.handleListProjects(args);
      case 'get_project_info':
        return await this.handleGetProjectInfo(args);
      case 'create_scene':
        return await this.handleCreateScene(args);
      case 'add_node':
        return await this.handleAddNode(args);
      case 'load_sprite':
        return await this.handleLoadSprite(args);
      case 'export_mesh_library':
        return await this.handleExportMeshLibrary(args);
      case 'save_scene':
        return await this.handleSaveScene(args);
      case 'get_uid':
        return await this.handleGetUid(args);
      case 'update_project_uids':
        return await this.handleUpdateProjectUids(args);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${tool}`);  
    }
  }

  private async handleLaunchEditor(args: any): Promise<ToolResponse> {
    if (!args.projectPath) {
      return {
        ok: false,
        summary: 'projectPath is required',
        details: { suggestions: ['Provide a Godot project directory'] },
      };
    }

    try {
      this.assertValidProject(args.projectPath);
      const godotPath = await this.ensureGodotPath(args.godotPath);
      spawn(godotPath, ['-e', '--path', args.projectPath], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      }).unref();
      return { ok: true, summary: 'Godot editor launched', details: { projectPath: args.projectPath } };
    } catch (error) {
      return {
        ok: false,
        summary: `Failed to launch editor: ${error instanceof Error ? error.message : String(error)}`,
        details: { suggestions: ['Ensure GODOT_PATH is correct', 'Verify the project contains project.godot'] },
      };
    }
  }

  private async handleRunProject(args: any): Promise<ToolResponse> {
    if (!args.projectPath) {
      return {
        ok: false,
        summary: 'projectPath is required',
        details: { suggestions: ['Provide a Godot project directory'] },
      };
    }

    try {
      this.assertValidProject(args.projectPath);
      const godotPath = await this.ensureGodotPath(args.godotPath);

      if (this.activeProcess) {
        this.logDebug('Killing existing Godot process before starting a new one');
        this.activeProcess.process.kill();
      }

      const cmdArgs = ['-d', '--path', args.projectPath];
      if (typeof args.scene === 'string' && args.scene.length > 0) {
        this.ensureNoTraversal(args.scene);
        cmdArgs.push(args.scene);
      }

      const proc = spawn(godotPath, cmdArgs, { stdio: 'pipe', windowsHide: true });
      const output: string[] = [];
      const errors: string[] = [];

      proc.stdout?.on('data', (data: Buffer) => output.push(...data.toString().split(/\r?\n/u)));
      proc.stderr?.on('data', (data: Buffer) => errors.push(...data.toString().split(/\r?\n/u)));

      proc.on('exit', () => {
        if (this.activeProcess && this.activeProcess.process === proc) this.activeProcess = null;
      });
      proc.on('error', () => {
        if (this.activeProcess && this.activeProcess.process === proc) this.activeProcess = null;
      });

      this.activeProcess = { process: proc, output, errors, projectPath: args.projectPath };
      return { ok: true, summary: 'Godot project started (debug mode)', details: { projectPath: args.projectPath } };
    } catch (error) {
      return {
        ok: false,
        summary: `Failed to run project: ${error instanceof Error ? error.message : String(error)}`,
        details: { suggestions: ['Ensure GODOT_PATH is correct', 'Verify the project contains project.godot'] },
      };
    }
  }

  private async handleGetDebugOutput(): Promise<ToolResponse> {
    if (!this.activeProcess) {
      return { ok: false, summary: 'No active Godot process', details: { suggestions: ['Use run_project first'] } };
    }

    return {
      ok: true,
      summary: 'Collected debug output',
      details: { output: this.activeProcess.output, errors: this.activeProcess.errors },
    };
  }

  private async handleStopProject(): Promise<ToolResponse> {
    if (!this.activeProcess) {
      return { ok: false, summary: 'No active Godot process to stop', details: { suggestions: ['Use run_project first'] } };
    }

    this.activeProcess.process.kill();
    const output = this.activeProcess.output;
    const errors = this.activeProcess.errors;
    this.activeProcess = null;
    return { ok: true, summary: 'Godot project stopped', details: { finalOutput: output, finalErrors: errors } };
  }

  private async handleGetGodotVersion(): Promise<ToolResponse> {
    try {
      const godotPath = await this.ensureGodotPath();
      const { stdout, stderr, exitCode } = await execGodot(godotPath, ['--version']);
      if (exitCode !== 0) {
        return {
          ok: false,
          summary: 'Failed to get Godot version',
          details: { exitCode },
          logs: splitLines(stderr),
        };
      }
      return { ok: true, summary: 'Godot version', details: { version: stdout.trim() } };
    } catch (error) {
      return { ok: false, summary: `Failed to get Godot version: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleListProjects(args: any): Promise<ToolResponse> {
    if (!args.directory) return { ok: false, summary: 'directory is required' };

    try {
      this.ensureNoTraversal(args.directory);
      if (!existsSync(args.directory)) {
        return { ok: false, summary: `Directory does not exist: ${args.directory}` };
      }
      const recursive = args.recursive === true;
      const projects = this.findGodotProjects(args.directory, recursive);
      return { ok: true, summary: `Found ${projects.length} project(s)`, details: { projects } };
    } catch (error) {
      return { ok: false, summary: `Failed to list projects: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleGetProjectInfo(args: any): Promise<ToolResponse> {
    if (!args.projectPath) return { ok: false, summary: 'projectPath is required' };

    try {
      this.assertValidProject(args.projectPath);
      const godotPath = await this.ensureGodotPath();
      const { stdout: versionStdout } = await execGodot(godotPath, ['--version']);

      const projectFile = path.join(args.projectPath, 'project.godot');
      let projectName = path.basename(args.projectPath);
      try {
        const contents = readFileSync(projectFile, 'utf8');
        const match = contents.match(/config\/name="([^"]+)"/u);
        if (match?.[1]) projectName = match[1];
      } catch {
        // ignore
      }

      const structure = await this.getProjectStructureCounts(args.projectPath);
      return {
        ok: true,
        summary: 'Project info',
        details: {
          name: projectName,
          path: args.projectPath,
          godotVersion: versionStdout.trim(),
          structure,
        },
      };
    } catch (error) {
      return { ok: false, summary: `Failed to get project info: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleCreateScene(args: any): Promise<ToolResponse> {
    if (!args.projectPath || !args.scenePath) {
      return { ok: false, summary: 'projectPath and scenePath are required' };
    }

    try {
      const absScene = resolveInsideProject(args.projectPath, args.scenePath);
      const res = await this.runHeadlessOp(
        'create_scene',
        { scenePath: args.scenePath, rootNodeType: args.rootNodeType ?? 'Node2D' },
        args.projectPath
      );
      if (!res.ok) {
        res.details = {
          ...(res.details ?? {}),
          suggestions: ['Check if rootNodeType is valid', `Target file: ${absScene}`],
        };
      }
      return res;
    } catch (error) {
      return { ok: false, summary: `Failed to create scene: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleAddNode(args: any): Promise<ToolResponse> {
    if (!args.projectPath || !args.scenePath || !args.nodeType || !args.nodeName) {
      return { ok: false, summary: 'projectPath, scenePath, nodeType, nodeName are required' };
    }

    try {
      const absScene = resolveInsideProject(args.projectPath, args.scenePath);
      if (!existsSync(absScene)) {
        return {
          ok: false,
          summary: `Scene file does not exist: ${args.scenePath}`,
          details: { suggestions: ['Run create_scene first', `Expected path: ${absScene}`] },
        };
      }

      const params: Record<string, unknown> = {
        scenePath: args.scenePath,
        parentNodePath: args.parentNodePath ?? 'root',
        nodeType: args.nodeType,
        nodeName: args.nodeName,
      };
      if (args.properties) params.properties = args.properties;

      return await this.runHeadlessOp('add_node', params, args.projectPath);
    } catch (error) {
      return { ok: false, summary: `Failed to add node: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleLoadSprite(args: any): Promise<ToolResponse> {
    if (!args.projectPath || !args.scenePath || !args.nodePath || !args.texturePath) {
      return { ok: false, summary: 'projectPath, scenePath, nodePath, texturePath are required' };
    }

    try {
      return await this.runHeadlessOp(
        'load_sprite',
        { scenePath: args.scenePath, nodePath: args.nodePath, texturePath: args.texturePath },
        args.projectPath
      );
    } catch (error) {
      return { ok: false, summary: `Failed to load sprite: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleExportMeshLibrary(args: any): Promise<ToolResponse> {
    if (!args.projectPath || !args.scenePath || !args.outputPath) {
      return { ok: false, summary: 'projectPath, scenePath, outputPath are required' };
    }

    try {
      const params: Record<string, unknown> = { scenePath: args.scenePath, outputPath: args.outputPath };
      if (args.meshItemNames) params.meshItemNames = args.meshItemNames;
      return await this.runHeadlessOp('export_mesh_library', params, args.projectPath);
    } catch (error) {
      return { ok: false, summary: `Failed to export mesh library: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleSaveScene(args: any): Promise<ToolResponse> {
    if (!args.projectPath || !args.scenePath) {
      return { ok: false, summary: 'projectPath and scenePath are required' };
    }

    try {
      const params: Record<string, unknown> = { scenePath: args.scenePath };
      if (args.newPath) params.newPath = args.newPath;
      return await this.runHeadlessOp('save_scene', params, args.projectPath);
    } catch (error) {
      return { ok: false, summary: `Failed to save scene: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleGetUid(args: any): Promise<ToolResponse> {
    if (!args.projectPath || !args.filePath) {
      return { ok: false, summary: 'projectPath and filePath are required' };
    }

    try {
      this.assertValidProject(args.projectPath);
      resolveInsideProject(args.projectPath, args.filePath);

      const godotPath = await this.ensureGodotPath();
      const { stdout: versionStdout } = await execGodot(godotPath, ['--version']);
      const version = versionStdout.trim();
      if (!this.isGodot44OrLater(version)) {
        return { ok: false, summary: `UIDs require Godot 4.4+. Current: ${version}` };
      }

      return await this.runHeadlessOp('get_uid', { filePath: args.filePath }, args.projectPath);
    } catch (error) {
      return { ok: false, summary: `Failed to get UID: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleUpdateProjectUids(args: any): Promise<ToolResponse> {
    if (!args.projectPath) return { ok: false, summary: 'projectPath is required' };

    try {
      this.assertValidProject(args.projectPath);

      const godotPath = await this.ensureGodotPath();
      const { stdout: versionStdout } = await execGodot(godotPath, ['--version']);
      const version = versionStdout.trim();
      if (!this.isGodot44OrLater(version)) {
        return { ok: false, summary: `UIDs require Godot 4.4+. Current: ${version}` };
      }

      return await this.runHeadlessOp('resave_resources', { projectPath: args.projectPath }, args.projectPath);
    } catch (error) {
      return { ok: false, summary: `Failed to update project UIDs: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleGodotHeadlessOp(args: any): Promise<ToolResponse> {
    if (!args.projectPath || !args.operation) {
      return { ok: false, summary: 'projectPath and operation are required' };
    }

    const params = (args.params && typeof args.params === 'object' ? args.params : {}) as Record<string, unknown>;
    return await this.runHeadlessOp(String(args.operation), params, args.projectPath);
  }

  private async handleGodotConnectEditor(args: any): Promise<ToolResponse> {
    if (!args.projectPath) return { ok: false, summary: 'projectPath is required' };

    try {
      this.assertValidProject(args.projectPath);

      const tokenFromArg = typeof args.token === 'string' && args.token.length > 0 ? args.token : undefined;
      const tokenFromEnv = typeof process.env.GODOT_MCP_TOKEN === 'string' ? process.env.GODOT_MCP_TOKEN : undefined;
      let token = tokenFromArg ?? tokenFromEnv;

      if (!token) {
        const tokenPath = path.join(args.projectPath, '.godot_mcp_token');
        if (existsSync(tokenPath)) token = readFileSync(tokenPath, 'utf8').trim();
      }

      if (!token) {
        return {
          ok: false,
          summary: 'Missing token for editor bridge',
          details: {
            suggestions: ['Set GODOT_MCP_TOKEN', 'Or create <project>/.godot_mcp_token', 'Enable addons/godot_mcp_bridge in the editor'],
          },
        };
      }

      const port = typeof args.port === 'number' ? args.port : 8765;
      const host = typeof args.host === 'string' ? args.host : '127.0.0.1';

      // Best-effort launch the editor; if it’s already running, connect will work.
      const godotPath = await this.ensureGodotPath(args.godotPath);       
      spawn(godotPath, ['-e', '--path', args.projectPath], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
        env: {
          ...process.env,
          GODOT_MCP_TOKEN: token,
          GODOT_MCP_PORT: String(port),
        },
      }).unref();

      const client = new EditorBridgeClient();
      const timeoutMs = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : 30000;
      const helloOk = await client.connect({ host, port, token, timeoutMs });

      this.editorClient?.close();
      this.editorClient = client;
      this.editorProjectPath = args.projectPath;

      return {
        ok: true,
        summary: 'Connected to editor bridge',
        details: { host, port, capabilities: helloOk.capabilities ?? {} },
      };
    } catch (error) {
      return {
        ok: false,
        summary: `Failed to connect editor bridge: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async handleGodotRpc(args: any): Promise<ToolResponse> {
    if (!this.editorClient || !this.editorClient.isConnected || !this.editorProjectPath) {
      return { ok: false, summary: 'Not connected to editor bridge', details: { suggestions: ['Call godot_connect_editor first'] } };
    }

    const requestJson = parseJsonish(args.request_json) as any;
    const method = typeof requestJson?.method === 'string' ? requestJson.method : undefined;
    const params = (requestJson?.params && typeof requestJson.params === 'object' ? requestJson.params : {}) as Record<string, unknown>;

    if (!method) {
      return {
        ok: false,
        summary: 'request_json.method is required',
        details: { example: { method: 'open_scene', params: { path: 'res://Main.tscn' } } },
      };
    }

    try {
      assertEditorRpcAllowed(method, params, this.editorProjectPath);
      const timeoutMs = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : 10000;
      const resp = await this.editorClient.request(method, params, timeoutMs);
      return {
        ok: resp.ok,
        summary: resp.ok ? `RPC ok: ${method}` : `RPC failed: ${method}`,  
        details: resp.ok ? { result: resp.result } : { error: resp.error },
      };
    } catch (error) {
      return { ok: false, summary: `RPC error: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async handleGodotInspect(args: any): Promise<ToolResponse> {
    if (!this.editorClient || !this.editorClient.isConnected || !this.editorProjectPath) {
      return { ok: false, summary: 'Not connected to editor bridge', details: { suggestions: ['Call godot_connect_editor first'] } };
    }

    const query = parseJsonish(args.query_json) as any;
    let method: string | undefined;
    let params: Record<string, unknown> = {};

    if (typeof query?.class_name === 'string' || typeof query?.className === 'string') {
      method = 'inspect_class';
      params = { class_name: (query.class_name ?? query.className) as string };
    } else if (typeof query?.node_path === 'string' || typeof query?.nodePath === 'string') {
      method = 'inspect_object';
      params = { node_path: (query.node_path ?? query.nodePath) as string };
    }

    if (!method) {
      return {
        ok: false,
        summary: 'Invalid query_json',
        details: { suggestions: ['Provide {class_name:\"Node2D\"} or {node_path:\"/root\"}'] },
      };
    }

    try {
      const timeoutMs = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : 10000;
      const resp = await this.editorClient.request(method, params, timeoutMs);
      return {
        ok: resp.ok,
        summary: resp.ok ? `Inspect ok: ${method}` : `Inspect failed: ${method}`,
        details: resp.ok ? { result: resp.result } : { error: resp.error },
      };
    } catch (error) {
      return { ok: false, summary: `Inspect error: ${error instanceof Error ? error.message : String(error)}` };
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
