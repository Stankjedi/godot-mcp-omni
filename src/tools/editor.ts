import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';

import { normalizeGodotArgsForHost } from '../godot_cli.js';
import { EditorBridgeClient } from '../editor_bridge_client.js';
import type { BridgeHelloOk } from '../editor_bridge_client.js';
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function pushSuggestion(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function normalizeProjectPathForCompare(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return '';
  const looksWindows = /^[a-zA-Z]:[\\/]/u.test(trimmed) || trimmed.includes('\\');
  const normalized = looksWindows ? path.win32.resolve(trimmed) : path.resolve(trimmed);
  return looksWindows ? normalized.toLowerCase() : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function getStringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

export function createEditorToolHandlers(ctx: ServerContext): Record<string, ToolHandler> {
  return {
    godot_connect_editor: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      const customGodotPath = asOptionalString(argsObj.godotPath, 'godotPath');
      const tokenFromArg = asOptionalString(argsObj.token, 'token');
      const customHost = asOptionalString(argsObj.host, 'host');
      const port = asOptionalPositiveNumber(argsObj.port, 'port');
      const timeoutMs = asOptionalPositiveNumber(argsObj.timeoutMs, 'timeoutMs');
      if (port !== undefined && !Number.isInteger(port)) {
        throw new ValidationError('port', 'Invalid field \"port\": expected integer', 'number');
      }

      let tokenSource: 'arg' | 'env' | 'file' | 'none' = 'none';
      let resolvedHost = '127.0.0.1';
      let resolvedPort = 8765;
      let resolvedTimeoutMs = 30000;
      let launchedRecently = false;
      const lockFilePath = path.join(projectPath, '.godot_mcp', 'bridge.lock');
      let lockFileExists = false;
      let lockWaitMs = 0;
      let connectBudgetMs = 0;

      try {
        ctx.assertValidProject(projectPath);
        const targetProject = normalizeProjectPathForCompare(projectPath);

        const trimmedTokenFromArg =
          tokenFromArg && tokenFromArg.trim().length > 0 ? tokenFromArg.trim() : undefined;
        const tokenFromEnv = typeof process.env.GODOT_MCP_TOKEN === 'string' ? process.env.GODOT_MCP_TOKEN : undefined;
        let token = trimmedTokenFromArg ?? tokenFromEnv;
        tokenSource = trimmedTokenFromArg ? 'arg' : tokenFromEnv ? 'env' : 'none';

        if (!token) {
          const tokenPath = path.join(projectPath, '.godot_mcp_token');
          if (existsSync(tokenPath)) {
            token = readFileSync(tokenPath, 'utf8').trim();
            tokenSource = token ? 'file' : tokenSource;
          }
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

        resolvedPort = typeof port === 'number' ? port : 8765;
        let hostFromFile: string | undefined;
        if (!customHost || customHost.trim().length === 0) {
          const hostPath = path.join(projectPath, '.godot_mcp_host');
          if (existsSync(hostPath)) {
            const raw = readFileSync(hostPath, 'utf8').trim();
            if (raw) hostFromFile = raw;
          }
        }
        resolvedHost = customHost && customHost.trim().length > 0 ? customHost.trim() : hostFromFile ?? '127.0.0.1';
        resolvedTimeoutMs = typeof timeoutMs === 'number' ? timeoutMs : 30000;
        lockWaitMs = Math.min(10000, Math.floor(resolvedTimeoutMs / 3));
        connectBudgetMs = Math.max(1000, resolvedTimeoutMs - lockWaitMs);
        lockFileExists = existsSync(lockFilePath);

        const existingClient = ctx.getEditorClient();
        const existingProjectPath = ctx.getEditorProjectPath();
        if (existingClient && existingClient.isConnected && existingProjectPath) {
          const currentProject = normalizeProjectPathForCompare(existingProjectPath);
          if (currentProject && currentProject === targetProject) {
            return {
              ok: true,
              summary: 'Already connected to editor bridge',
              details: {
                host: resolvedHost,
                port: resolvedPort,
                capabilities: {},
                reused: true,
              },
            };
          }
          existingClient.close();
          ctx.setEditorClient(null);
          ctx.setEditorProjectPath(null);
        }

        const client = new EditorBridgeClient();
        const probeTimeoutMs = Math.min(2000, resolvedTimeoutMs);
        const launchInfo = ctx.getEditorLaunchInfo();
        const launchWindowMs = 120_000;
        launchedRecently =
          Boolean(launchInfo) &&
          normalizeProjectPathForCompare(launchInfo?.projectPath ?? '') === targetProject &&
          typeof launchInfo?.ts === 'number' &&
          Date.now() - (launchInfo?.ts ?? 0) < launchWindowMs;

        const wait = (ms: number) =>
          new Promise((resolve) => {
            setTimeout(resolve, ms);
          });

        const waitForLockFile = async (maxWaitMs: number): Promise<boolean> => {
          if (maxWaitMs <= 0) return existsSync(lockFilePath);
          const start = Date.now();
          while (Date.now() - start < maxWaitMs) {
            if (existsSync(lockFilePath)) return true;
            await wait(250);
          }
          return existsSync(lockFilePath);
        };

        const connectOnce = async (timeoutMsValue: number) => {
          try {
            return await client.connect({
              host: resolvedHost,
              port: resolvedPort,
              token,
              timeoutMs: timeoutMsValue,
            });
          } catch (err) {
            client.close();
            throw err;
          }
        };

        const isAuthError = (error: unknown): boolean => {
          const message = error instanceof Error ? error.message : String(error);
          const lower = message.toLowerCase();
          return (
            lower.includes('invalid token') ||
            lower.includes('token not configured') ||
            lower.includes('hello')
          );
        };

        const connectWithRetry = async (totalTimeoutMs: number): Promise<BridgeHelloOk> => {
          const start = Date.now();
          let lastError: unknown;
          while (Date.now() - start < totalTimeoutMs) {
            const remaining = totalTimeoutMs - (Date.now() - start);
            const attemptTimeout = Math.max(250, Math.min(2000, remaining));
            try {
              return await connectOnce(attemptTimeout);
            } catch (error) {
              if (isAuthError(error)) throw error;
              lastError = error;
            }
            if (remaining <= 0) break;
            await wait(Math.min(250, remaining));
          }
          throw lastError ?? new Error(`Editor bridge connect timeout after ${totalTimeoutMs}ms`);
        };

        const verifyProject = async (): Promise<boolean> => {
          try {
            const healthResp = await client.request('health', {}, Math.min(2000, resolvedTimeoutMs));
            if (!healthResp.ok || !isRecord(healthResp.result)) return true;
            const projectRoot = healthResp.result.project_root;
            if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) return true;
            const reported = normalizeProjectPathForCompare(projectRoot);
            return reported.length > 0 ? reported === targetProject : true;
          } catch {
            return true;
          }
        };

        let helloOk;
        try {
          // Prefer reusing an existing editor instance.
          helloOk = await connectOnce(probeTimeoutMs);
          const verified = await verifyProject();
          if (!verified) {
            client.close();
            const godotPath = await ctx.ensureGodotPath(customGodotPath);
            spawn(godotPath, normalizeGodotArgsForHost(godotPath, ['-e', '--path', projectPath]), {
              stdio: 'ignore',
              detached: true,
              windowsHide: true,
              env: {
                ...process.env,
                GODOT_MCP_TOKEN: token,
                GODOT_MCP_PORT: String(resolvedPort),
              },
            }).unref();
            ctx.setEditorLaunchInfo({ projectPath, ts: Date.now() });
            lockFileExists = await waitForLockFile(lockWaitMs);
            helloOk = await connectWithRetry(connectBudgetMs);
          }
        } catch (error) {
          if (isAuthError(error)) throw error;

          if (launchedRecently) {
            // Editor was just launched; wait for the bridge instead of spawning another window.
            if (!lockFileExists) {
              lockFileExists = await waitForLockFile(lockWaitMs);
            }
            if (!lockFileExists) {
              const godotPath = await ctx.ensureGodotPath(customGodotPath);
              spawn(godotPath, normalizeGodotArgsForHost(godotPath, ['-e', '--path', projectPath]), {
                stdio: 'ignore',
                detached: true,
                windowsHide: true,
                env: {
                  ...process.env,
                  GODOT_MCP_TOKEN: token,
                  GODOT_MCP_PORT: String(resolvedPort),
                },
              }).unref();
              ctx.setEditorLaunchInfo({ projectPath, ts: Date.now() });
              lockFileExists = await waitForLockFile(lockWaitMs);
            }
            helloOk = await connectWithRetry(connectBudgetMs);
          } else {
            // Fallback: launch editor if no server is listening.
            const godotPath = await ctx.ensureGodotPath(customGodotPath);
            spawn(godotPath, normalizeGodotArgsForHost(godotPath, ['-e', '--path', projectPath]), {
              stdio: 'ignore',
              detached: true,
              windowsHide: true,
              env: {
                ...process.env,
                GODOT_MCP_TOKEN: token,
                GODOT_MCP_PORT: String(resolvedPort),
              },
            }).unref();
            ctx.setEditorLaunchInfo({ projectPath, ts: Date.now() });
            lockFileExists = await waitForLockFile(lockWaitMs);
            helloOk = await connectWithRetry(connectBudgetMs);
          }
        }

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
        const message = getErrorMessage(error);
        const code = getErrorCode(error);
        const lower = message.toLowerCase();
        const isAuth = lower.includes('invalid token') || lower.includes('token not configured') || lower.includes('hello');
        const isConnRefused = code === 'ECONNREFUSED' || lower.includes('econnrefused');
        const isTimeout = lower.includes('timeout');
        const suggestions: string[] = [];

        if (isAuth) {
          pushSuggestion(suggestions, 'Ensure GODOT_MCP_TOKEN matches the editor plugin token.');
          pushSuggestion(suggestions, 'Verify <project>/.godot_mcp_token if you are not passing a token arg.');
        }
        if (isConnRefused) {
          pushSuggestion(suggestions, 'Confirm the editor is running and the plugin is enabled (Project Settings → Plugins).');
          pushSuggestion(suggestions, 'Check that the port is reachable and not blocked by a firewall.');
        }
        if (isTimeout) {
          pushSuggestion(suggestions, 'Wait for the editor to finish startup/import, then retry.');
          pushSuggestion(suggestions, 'Increase timeoutMs for slower machines or large projects.');
        }
        if (lockFileExists) {
          pushSuggestion(suggestions, 'A bridge lock file exists; ensure the editor is running and the plugin started.');
        } else {
          pushSuggestion(suggestions, 'Open the project once and enable the Godot MCP Bridge plugin.');
        }
        pushSuggestion(suggestions, 'Verify GODOT_PATH points to a working Godot executable.');

        return {
          ok: false,
          summary: `Failed to connect editor bridge: ${message}`,
          details: {
            host: resolvedHost,
            port: resolvedPort,
            timeoutMs: resolvedTimeoutMs,
            launchedRecently,
            tokenSource,
            lockFilePath,
            lockFileExists,
            lastError: { message, code, auth: isAuth, timeout: isTimeout },
            suggestions,
          },
        };
      }
    },

    godot_rpc: async (args: unknown): Promise<ToolResponse> => {
      const client = ctx.getEditorClient();
      const projectPath = ctx.getEditorProjectPath();
      if (!client || !client.isConnected || !projectPath) {
        return {
          ok: false,
          summary: 'Not connected to editor bridge',
          details: { suggestions: ['Call godot_connect_editor first'] },
        };
      }

      const argsObj = asRecord(args, 'args');
      const requestJson = asRecord(parseJsonish(argsObj.request_json), 'request_json');
      const method = asNonEmptyString(getStringField(requestJson, 'method'), 'request_json.method');
      const params = asOptionalRecord(requestJson.params, 'request_json.params') ?? {};
      const timeoutMs = asOptionalPositiveNumber(argsObj.timeoutMs, 'timeoutMs') ?? 10000;

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

    godot_inspect: async (args: unknown): Promise<ToolResponse> => {
      const client = ctx.getEditorClient();
      const projectPath = ctx.getEditorProjectPath();
      if (!client || !client.isConnected || !projectPath) {
        return {
          ok: false,
          summary: 'Not connected to editor bridge',
          details: { suggestions: ['Call godot_connect_editor first'] },
        };
      }

      const argsObj = asRecord(args, 'args');
      const query = asRecord(parseJsonish(argsObj.query_json), 'query_json');
      const timeoutMs = asOptionalPositiveNumber(argsObj.timeoutMs, 'timeoutMs') ?? 10000;

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

      const className = getStringField(query, 'class_name') ?? getStringField(query, 'className');
      const nodePath = getStringField(query, 'node_path') ?? getStringField(query, 'nodePath');
      const instanceIdRaw = query.instance_id ?? query.instanceId;

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
