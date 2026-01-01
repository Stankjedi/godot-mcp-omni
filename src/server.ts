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
import { MCP_SERVER_INFO } from './server_info.js';

import { createEditorToolHandlers } from './tools/editor.js';
import { createHeadlessToolHandlers } from './tools/headless.js';
import { createAsepriteToolHandlers } from './tools/aseprite.js';
import { createAsepriteManagerToolHandlers } from './tools/aseprite_manager.js';
import { createMacroManagerToolHandlers } from './tools/macro_manager.js';
import { createPixelToolHandlers } from './tools/pixel.js';
import { createPixelManagerToolHandlers } from './tools/pixel_manager.js';
import { createProjectToolHandlers } from './tools/project.js';
import { createUnifiedToolHandlers } from './tools/unified.js';
import { createWorkflowManagerToolHandlers } from './tools/workflow_manager.js';

import { ASEPRITE_TOOL_DEFINITIONS } from './tools/definitions/aseprite_tools.js';
import { EDITOR_RPC_TOOL_DEFINITIONS } from './tools/definitions/editor_rpc_tools.js';
import { HEADLESS_TOOL_DEFINITIONS } from './tools/definitions/headless_tools.js';
import { MACRO_TOOL_DEFINITIONS } from './tools/definitions/macro_tools.js';
import { PIXEL_MANAGER_TOOL_DEFINITIONS } from './tools/definitions/pixel_manager_tools.js';
import { PIXEL_TOOL_DEFINITIONS } from './tools/definitions/pixel_tools.js';
import { PROJECT_TOOL_DEFINITIONS } from './tools/definitions/project_tools.js';
import { UNIFIED_TOOL_DEFINITIONS } from './tools/definitions/unified_tools.js';
import { WORKFLOW_TOOL_DEFINITIONS } from './tools/definitions/workflow_tools.js';

import type { EditorBridgeClient } from './editor_bridge_client.js';
import type { ServerContext } from './tools/context.js';
import type { ToolDefinition } from './tools/definitions/tool_definition.js';
import type { GodotProcess, ToolHandler, ToolResponse } from './tools/types.js';

const DEBUG_MODE = process.env.DEBUG === 'true';

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

const TOOL_DEFINITIONS: ToolDefinition[] = [
  ...HEADLESS_TOOL_DEFINITIONS,
  ...EDITOR_RPC_TOOL_DEFINITIONS,
  ...PROJECT_TOOL_DEFINITIONS,
  ...UNIFIED_TOOL_DEFINITIONS,
  ...ASEPRITE_TOOL_DEFINITIONS,
  ...PIXEL_MANAGER_TOOL_DEFINITIONS,
  ...MACRO_TOOL_DEFINITIONS,
  ...PIXEL_TOOL_DEFINITIONS,
  ...WORKFLOW_TOOL_DEFINITIONS,
];

export class GodotMcpOmniServer {
  private server: Server;
  private activeProcess: GodotProcess | null = null;
  private godotPath: string | null = null;
  private operationsScriptPath: string;
  private strictPathValidation = false;
  private validatedGodotPathCache: Map<string, boolean> = new Map();
  private cleanupPromise: Promise<void> | null = null;

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

    this.server = new Server(MCP_SERVER_INFO, { capabilities: { tools: {} } });

    this.toolHandlers = this.createToolHandlers();
    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);

    const shutdown = (signal: string) => {
      void (async () => {
        try {
          this.logDebug(`Received ${signal}; shutting down...`);
          await this.cleanup();
        } finally {
          process.exit(0);
        }
      })();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
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

    const asepriteHandlers = createAsepriteToolHandlers(ctx);
    const asepriteManagerHandlers = createAsepriteManagerToolHandlers(
      ctx,
      unifiedHandlers,
    );

    const pixelHandlers = createPixelToolHandlers(ctx, {
      ...headlessHandlers,
      ...editorHandlers,
      ...projectHandlers,
      ...unifiedHandlers,
    });

    const pixelManagerHandlers = createPixelManagerToolHandlers(ctx, {
      ...headlessHandlers,
      ...editorHandlers,
      ...projectHandlers,
      ...unifiedHandlers,
      ...pixelHandlers,
    });

    const macroManagerHandlers = createMacroManagerToolHandlers(ctx, {
      ...headlessHandlers,
      ...editorHandlers,
      ...projectHandlers,
      ...unifiedHandlers,
      ...pixelHandlers,
      ...pixelManagerHandlers,
    });

    const workflowManagerHandlers = createWorkflowManagerToolHandlers(ctx, {
      dispatchTool: async (tool, args) => await this.dispatchTool(tool, args),
      normalizeParameters: (p) => this.normalizeParameters(p),
      listTools: () => TOOL_DEFINITIONS,
    });

    return {
      ...headlessHandlers,
      ...editorHandlers,
      ...projectHandlers,
      ...asepriteHandlers,
      ...asepriteManagerHandlers,
      ...unifiedHandlers,
      ...pixelHandlers,
      ...pixelManagerHandlers,
      ...macroManagerHandlers,
      ...workflowManagerHandlers,
    };
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOL_DEFINITIONS,
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

  private cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;

    this.cleanupPromise = (async () => {
      const active = this.activeProcess;
      this.activeProcess = null;
      if (active) {
        try {
          active.process.kill();
        } catch (error) {
          this.logDebug(`Active process kill failed: ${String(error)}`);
        }
      }

      const client = this.editorClient;
      this.editorClient = null;
      if (client) {
        try {
          client.close();
        } catch (error) {
          this.logDebug(`Editor client close failed: ${String(error)}`);
        }
      }

      try {
        await this.server.close();
      } catch (error) {
        this.logDebug(`Server close failed: ${String(error)}`);
      }
    })();

    return this.cleanupPromise;
  }

  async run(): Promise<void> {
    await this.ensureGodotPath();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('godot-mcp-omni server running on stdio');
  }
}
