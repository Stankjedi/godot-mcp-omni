import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';

import { EditorBridgeClient } from '../editor_bridge_client.js';
import { assertEditorRpcAllowed } from '../security.js';
import {
  ValidationError,
  asNonEmptyString,
  asOptionalPositiveNumber,
  asOptionalRecord,
  asOptionalString,
  asPositiveNumber,
  asRecord,
} from '../validation.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';

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

export function createEditorToolHandlers(ctx: ServerContext): Record<string, ToolHandler> {
  return {
    godot_connect_editor: async (args: any): Promise<ToolResponse> => {
      const projectPath = asNonEmptyString(args.projectPath, 'projectPath');
      const customGodotPath = asOptionalString(args.godotPath, 'godotPath');
      const tokenFromArg = asOptionalString(args.token, 'token');
      const customHost = asOptionalString(args.host, 'host');
      const port = asOptionalPositiveNumber(args.port, 'port');
      const timeoutMs = asOptionalPositiveNumber(args.timeoutMs, 'timeoutMs');
      if (port !== undefined && !Number.isInteger(port)) {
        throw new ValidationError('port', 'Invalid field \"port\": expected integer', 'number');
      }

      try {
        ctx.assertValidProject(projectPath);

        const trimmedTokenFromArg =
          tokenFromArg && tokenFromArg.trim().length > 0 ? tokenFromArg.trim() : undefined;
        const tokenFromEnv = typeof process.env.GODOT_MCP_TOKEN === 'string' ? process.env.GODOT_MCP_TOKEN : undefined;
        let token = trimmedTokenFromArg ?? tokenFromEnv;

        if (!token) {
          const tokenPath = path.join(projectPath, '.godot_mcp_token');
          if (existsSync(tokenPath)) token = readFileSync(tokenPath, 'utf8').trim();
        }

        if (!token) {
          return {
            ok: false,
            summary: 'Missing token for editor bridge',
            details: {
              suggestions: [
                'Set GODOT_MCP_TOKEN',
                'Or create <project>/.godot_mcp_token',
                'Enable addons/godot_mcp_bridge in the editor',
              ],
            },
          };
        }

        const resolvedPort = typeof port === 'number' ? port : 8765;
        const resolvedHost = customHost && customHost.trim().length > 0 ? customHost.trim() : '127.0.0.1';

        // Best-effort launch the editor; if it’s already running, connect will work.
        const godotPath = await ctx.ensureGodotPath(customGodotPath);
        spawn(godotPath, ['-e', '--path', projectPath], {
          stdio: 'ignore',
          detached: true,
          windowsHide: true,
          env: {
            ...process.env,
            GODOT_MCP_TOKEN: token,
            GODOT_MCP_PORT: String(resolvedPort),
          },
        }).unref();

        const client = new EditorBridgeClient();
        const resolvedTimeoutMs = typeof timeoutMs === 'number' ? timeoutMs : 30000;
        const helloOk = await client.connect({
          host: resolvedHost,
          port: resolvedPort,
          token,
          timeoutMs: resolvedTimeoutMs,
        });

        ctx.setEditorClient(client);
        ctx.setEditorProjectPath(projectPath);

        return {
          ok: true,
          summary: 'Connected to editor bridge',
          details: {
            host: resolvedHost,
            port: resolvedPort,
            capabilities: helloOk.capabilities ?? {},
          },
        };
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to connect editor bridge: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    godot_rpc: async (args: any): Promise<ToolResponse> => {
      const client = ctx.getEditorClient();
      const projectPath = ctx.getEditorProjectPath();
      if (!client || !client.isConnected || !projectPath) {
        return {
          ok: false,
          summary: 'Not connected to editor bridge',
          details: { suggestions: ['Call godot_connect_editor first'] },
        };
      }

      const requestJson = asRecord(parseJsonish(args.request_json), 'request_json');
      const method = asNonEmptyString((requestJson as any).method, 'request_json.method');
      const params = asOptionalRecord((requestJson as any).params, 'request_json.params') ?? {};
      const timeoutMs = asOptionalPositiveNumber(args.timeoutMs, 'timeoutMs') ?? 10000;

      try {
        assertEditorRpcAllowed(method, params, projectPath);
        const resp = await client.request(method, params, timeoutMs);
        return {
          ok: resp.ok,
          summary: resp.ok ? `RPC ok: ${method}` : `RPC failed: ${method}`,
          details: resp.ok ? { result: resp.result } : { error: resp.error },
        };
      } catch (error) {
        return { ok: false, summary: `RPC error: ${error instanceof Error ? error.message : String(error)}` };
      }
    },

    godot_inspect: async (args: any): Promise<ToolResponse> => {
      const client = ctx.getEditorClient();
      const projectPath = ctx.getEditorProjectPath();
      if (!client || !client.isConnected || !projectPath) {
        return {
          ok: false,
          summary: 'Not connected to editor bridge',
          details: { suggestions: ['Call godot_connect_editor first'] },
        };
      }

      const query = asRecord(parseJsonish(args.query_json), 'query_json');
      const timeoutMs = asOptionalPositiveNumber(args.timeoutMs, 'timeoutMs') ?? 10000;

      const allowedKeys = new Set([
        'class_name',
        'className',
        'node_path',
        'nodePath',
        'instance_id',
        'instanceId',
      ]);
      const unknownKeys = Object.keys(query).filter((k) => !allowedKeys.has(k));
      if (unknownKeys.length > 0) {
        throw new ValidationError(
          'query_json',
          `Invalid field \"query_json\": unknown keys: ${unknownKeys.join(', ')}`,
          'object'
        );
      }

      const className =
        typeof (query as any).class_name === 'string'
          ? (query as any).class_name
          : typeof (query as any).className === 'string'
          ? (query as any).className
          : undefined;

      const nodePath =
        typeof (query as any).node_path === 'string'
          ? (query as any).node_path
          : typeof (query as any).nodePath === 'string'
          ? (query as any).nodePath
          : undefined;

      const instanceIdRaw = (query as any).instance_id ?? (query as any).instanceId;

      const modeCount = Number(Boolean(className)) + Number(Boolean(nodePath)) + Number(instanceIdRaw !== undefined);
      if (modeCount !== 1) {
        throw new ValidationError(
          'query_json',
          'Invalid field \"query_json\": expected exactly one of {class_name}, {node_path}, {instance_id}',
          'object'
        );
      }

      let method: string;
      let params: Record<string, unknown>;

      if (className !== undefined) {
        method = 'inspect_class';
        params = { class_name: asNonEmptyString(className, 'query_json.class_name') };
      } else if (nodePath !== undefined) {
        method = 'inspect_object';
        params = { node_path: asNonEmptyString(nodePath, 'query_json.node_path') };
      } else {
        const instanceId = asPositiveNumber(instanceIdRaw, 'query_json.instance_id');
        if (!Number.isInteger(instanceId)) {
          throw new ValidationError(
            'query_json.instance_id',
            'Invalid field \"query_json.instance_id\": expected integer',
            'number'
          );
        }
        method = 'inspect_object';
        params = { instance_id: instanceId };
      }

      try {
        const resp = await client.request(method, params, timeoutMs);
        return {
          ok: resp.ok,
          summary: resp.ok ? `Inspect ok: ${method}` : `Inspect failed: ${method}`,
          details: resp.ok ? { result: resp.result } : { error: resp.error },
        };
      } catch (error) {
        return { ok: false, summary: `Inspect error: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}

