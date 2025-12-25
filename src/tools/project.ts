import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, readFileSync } from 'fs';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import net from 'net';

import { execGodot, normalizeGodotArgsForHost } from '../godot_cli.js';
import {
  ValidationError,
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNonEmptyString,
  asOptionalPositiveNumber,
  asRecord,
  asOptionalString,
} from '../validation.js';

import type { ServerContext } from './context.js';
import type { GodotProcess, ToolHandler, ToolResponse } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function findGodotProjects(
  directory: string,
  recursive: boolean,
  logDebug: (message: string) => void,
): { path: string; name: string }[] {
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

      if (recursive)
        projects.push(...findGodotProjects(subdir, true, logDebug));
    }
  } catch (error) {
    logDebug(`Error searching directory ${directory}: ${String(error)}`);
  }
  return projects;
}

async function getProjectStructureCounts(
  projectPath: string,
  logDebug: (message: string) => void,
): Promise<Record<string, number>> {
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
      else if (ext === 'gd' || ext === 'gdscript' || ext === 'cs')
        structure.scripts += 1;
      else if (
        [
          'png',
          'jpg',
          'jpeg',
          'webp',
          'svg',
          'ttf',
          'wav',
          'mp3',
          'ogg',
        ].includes(ext ?? '')
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
    logDebug(`Error scanning project structure: ${String(error)}`);
  }

  return structure;
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

function collectLogs(stdout: string, stderr: string, limit = 200): string[] {
  const logs = [...splitLines(stdout), ...splitLines(stderr)];
  return logs.length > limit ? logs.slice(0, limit) : logs;
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/gu, '\n');
}

function serializePackedStringArray(values: string[]): string {
  const uniq = Array.from(new Set(values)).filter(Boolean);
  const quoted = uniq
    .map((v) => `"${String(v).replaceAll('"', '\\"')}"`)
    .join(', ');
  return `PackedStringArray(${quoted})`;
}

export function ensureEditorPluginEnabled(
  projectGodotText: string,
  pluginId: string,
): string {
  const lines = normalizeNewlines(projectGodotText).split('\n');

  let sectionStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '[editor_plugins]') {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    const out = [...lines];
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push('[editor_plugins]');
    out.push(`enabled=${serializePackedStringArray([pluginId])}`);
    out.push('');
    return out.join('\n');
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^\s*\[[^\]]+\]\s*$/u.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  let enabledLineIndex = -1;
  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    if (lines[i].trim().startsWith('enabled=')) {
      enabledLineIndex = i;
      break;
    }
  }

  if (enabledLineIndex === -1) {
    const out = [...lines];
    out.splice(
      sectionEnd,
      0,
      `enabled=${serializePackedStringArray([pluginId])}`,
    );
    return out.join('\n');
  }

  const enabledLine = lines[enabledLineIndex];
  const matches = Array.from(enabledLine.matchAll(/"([^"]*)"/gu)).map(
    (m) => m[1],
  );
  const next = matches.includes(pluginId) ? matches : [...matches, pluginId];

  const out = [...lines];
  out[enabledLineIndex] = `enabled=${serializePackedStringArray(next)}`;
  return out.join('\n');
}

function isEditorPluginEnabled(
  projectGodotText: string,
  pluginId: string,
): boolean {
  const lines = normalizeNewlines(projectGodotText).split('\n');

  let sectionStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '[editor_plugins]') {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart === -1) return false;

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^\s*\[[^\]]+\]\s*$/u.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('enabled=')) continue;
    const enabled = Array.from(line.matchAll(/"([^"]*)"/gu)).map((m) => m[1]);
    return enabled.includes(pluginId);
  }

  return false;
}

function getNodeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

async function checkTcpPortAvailability(
  host: string,
  port: number,
  timeoutMs = 500,
): Promise<{ status: 'available' | 'in_use' | 'error'; error?: string }> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;

    const finish = (result: {
      status: 'available' | 'in_use' | 'error';
      error?: string;
    }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        server.close();
      } catch {
        // ignore
      }
      finish({ status: 'error', error: 'timeout' });
    }, timeoutMs);

    server.once('error', (err) => {
      clearTimeout(timer);
      const code = getNodeErrorCode(err);
      if (code === 'EADDRINUSE') {
        finish({ status: 'in_use' });
        return;
      }
      finish({ status: 'error', error: String(err) });
    });

    server.listen({ host, port }, () => {
      server.close(() => {
        clearTimeout(timer);
        finish({ status: 'available' });
      });
    });
  });
}

export function createProjectToolHandlers(
  ctx: ServerContext,
): Record<string, ToolHandler> {
  return {
    godot_preflight: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      const godotPathArg = normalizeOptionalString(
        asOptionalString(argsObj.godotPath, 'godotPath'),
      );
      const host =
        normalizeOptionalString(asOptionalString(argsObj.host, 'host')) ??
        '127.0.0.1';

      const port = asOptionalPositiveNumber(argsObj.port, 'port');
      if (port !== undefined && !Number.isInteger(port)) {
        throw new ValidationError(
          'port',
          'Invalid field "port": expected integer',
          'number',
        );
      }
      const portToCheck = typeof port === 'number' ? port : 8765;

      const logs: string[] = [];
      const suggestions: string[] = [];
      const checks: Record<string, unknown> = {};

      // Project checks (required)
      try {
        ctx.ensureNoTraversal(projectPath);
      } catch (error) {
        suggestions.push('Use a valid projectPath without ".." segments.');
        return {
          ok: false,
          summary: 'Preflight failed',
          details: {
            checks: {
              project: {
                status: 'error',
                reason: error instanceof Error ? error.message : String(error),
              },
            },
            suggestions,
          },
          logs,
        };
      }

      if (!existsSync(projectPath)) {
        suggestions.push('Verify the projectPath exists.');
        return {
          ok: false,
          summary: 'Preflight failed',
          details: {
            checks: {
              project: {
                status: 'error',
                reason: `Project path does not exist: ${projectPath}`,
              },
            },
            suggestions,
          },
          logs,
        };
      }

      const projectGodotPath = path.join(projectPath, 'project.godot');
      if (!existsSync(projectGodotPath)) {
        suggestions.push(
          'Create a valid Godot project (missing project.godot).',
        );
        return {
          ok: false,
          summary: 'Preflight failed',
          details: {
            checks: {
              project: {
                status: 'error',
                reason: `Not a valid Godot project (missing project.godot): ${projectPath}`,
              },
            },
            suggestions,
          },
          logs,
        };
      }

      checks.project = { status: 'ok', projectPath, projectGodotPath };

      // Addon checks (best-effort)
      let projectGodotText = '';
      try {
        projectGodotText = await fs.readFile(projectGodotPath, 'utf8');
      } catch {
        // ignore
      }

      const addonDir = path.join(projectPath, 'addons', 'godot_mcp_bridge');
      const addonPluginCfg = path.join(addonDir, 'plugin.cfg');
      const addonPresent = existsSync(addonPluginCfg);
      const addonEnabled = projectGodotText
        ? isEditorPluginEnabled(projectGodotText, 'godot_mcp_bridge')
        : false;

      checks.addon = {
        status: addonPresent ? (addonEnabled ? 'ok' : 'disabled') : 'missing',
        addonDir,
        addonPresent,
        addonEnabled,
      };

      if (!addonPresent) {
        suggestions.push(
          'If you plan to use editor features, run godot_sync_addon to install the editor bridge addon.',
        );
      } else if (!addonEnabled) {
        suggestions.push(
          'Enable the editor plugin "godot_mcp_bridge" (run godot_sync_addon with enablePlugin=true or enable it in the editor).',
        );
      }

      // Port checks (best-effort)
      try {
        const portCheck = await checkTcpPortAvailability(host, portToCheck);
        checks.port = { host, port: portToCheck, ...portCheck };
        if (portCheck.status === 'in_use') {
          suggestions.push(
            `Port ${portToCheck} is already in use on ${host}. Choose another port or stop the process using it.`,
          );
        }
      } catch (error) {
        checks.port = {
          host,
          port: portToCheck,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Godot checks (optional; do not require by default)
      const envGodotPath = normalizeOptionalString(process.env.GODOT_PATH);
      const godotCandidate = godotPathArg ?? envGodotPath;

      if (!godotCandidate) {
        checks.godot = { status: 'skipped' };
      } else {
        const { stdout, stderr, exitCode } = await execGodot(godotCandidate, [
          '--version',
        ]);
        const version = stdout.trim();
        const ok = exitCode === 0;
        checks.godot = {
          status: ok ? 'ok' : 'error',
          godotPath: godotCandidate,
          version: version.length > 0 ? version : undefined,
          exitCode,
          stderr: stderr.trim().length > 0 ? stderr.trim().slice(0, 500) : '',
        };

        if (!ok) {
          suggestions.push(
            'Set a valid GODOT_PATH (or pass godotPath explicitly) to run headless/editor workflows.',
          );
        }
      }

      const godotCheck = checks.godot as Record<string, unknown>;
      const godotOk = godotCheck.status !== 'error';

      return {
        ok: godotOk,
        summary: godotOk
          ? 'Preflight OK'
          : 'Preflight failed (Godot missing or invalid)',
        details: {
          checks,
          suggestions,
        },
        logs,
      };
    },

    launch_editor: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      const godotPathArg = normalizeOptionalString(
        asOptionalString(argsObj.godotPath, 'godotPath'),
      );
      const tokenRaw = asOptionalString(argsObj.token, 'token');
      const port = asOptionalPositiveNumber(argsObj.port, 'port');
      if (port !== undefined && !Number.isInteger(port)) {
        throw new ValidationError(
          'port',
          'Invalid field "port": expected integer',
          'number',
        );
      }
      const token =
        tokenRaw && tokenRaw.trim().length > 0 ? tokenRaw.trim() : undefined;

      try {
        ctx.assertValidProject(projectPath);
        const godotPath = await ctx.ensureGodotPath(godotPathArg);

        const shouldWriteBridgeConfig =
          process.platform !== 'win32' &&
          godotPath.trim().toLowerCase().endsWith('.exe');
        if (shouldWriteBridgeConfig) {
          const envPortRaw = process.env.GODOT_MCP_PORT?.trim() ?? '';
          const envPort = envPortRaw ? Number.parseInt(envPortRaw, 10) : NaN;
          const portToWrite =
            typeof port === 'number'
              ? port
              : Number.isInteger(envPort)
                ? envPort
                : undefined;
          if (
            typeof portToWrite === 'number' &&
            Number.isInteger(portToWrite) &&
            portToWrite > 0
          ) {
            await fs.writeFile(
              path.join(projectPath, '.godot_mcp_port'),
              String(portToWrite),
              'utf8',
            );
          }

          try {
            const route = readFileSync('/proc/net/route', 'utf8');
            const lines = route.split(/\r?\n/u);
            for (let i = 1; i < lines.length; i += 1) {
              const line = lines[i]?.trim();
              if (!line) continue;
              const cols = line.split(/\s+/u);
              if (cols.length < 3) continue;
              if (cols[1] !== '00000000') continue;
              const hex = cols[2];
              if (!/^[0-9a-fA-F]+$/u.test(hex)) continue;
              const num = (Number.parseInt(hex, 16) >>> 0) as number;
              const gatewayIp = [
                num & 0xff,
                (num >>> 8) & 0xff,
                (num >>> 16) & 0xff,
                (num >>> 24) & 0xff,
              ].join('.');
              if (gatewayIp !== '0.0.0.0') {
                await fs.writeFile(
                  path.join(projectPath, '.godot_mcp_host'),
                  gatewayIp,
                  'utf8',
                );
                break;
              }
            }
          } catch {
            // Best-effort only; default stays 127.0.0.1.
          }
        }

        spawn(
          godotPath,
          normalizeGodotArgsForHost(godotPath, ['-e', '--path', projectPath]),
          {
            stdio: 'ignore',
            detached: true,
            windowsHide: true,
            env: {
              ...process.env,
              ...(token ? { GODOT_MCP_TOKEN: token } : {}),
              ...(port ? { GODOT_MCP_PORT: String(port) } : {}),
            },
          },
        ).unref();
        ctx.setEditorLaunchInfo({ projectPath, ts: Date.now() });
        return {
          ok: true,
          summary: 'Godot editor launched',
          details: { projectPath },
        };
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        return {
          ok: false,
          summary: `Failed to launch editor: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            suggestions: [
              'Ensure GODOT_PATH is correct',
              'Verify the project contains project.godot',
            ],
          },
        };
      }
    },

    run_project: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      const godotPathArg = normalizeOptionalString(
        asOptionalString(argsObj.godotPath, 'godotPath'),
      );
      const sceneRaw = asOptionalNonEmptyString(argsObj.scene, 'scene');
      const scene = sceneRaw ? sceneRaw.trim() : undefined;

      try {
        ctx.assertValidProject(projectPath);
        const godotPath = await ctx.ensureGodotPath(godotPathArg);

        const existing = ctx.getActiveProcess();
        if (existing) {
          ctx.logDebug(
            'Killing existing Godot process before starting a new one',
          );
          existing.process.kill();
        }

        const cmdArgs = ['-d', '--path', projectPath];
        if (scene) {
          ctx.ensureNoTraversal(scene);
          cmdArgs.push(scene);
        }

        const proc = spawn(
          godotPath,
          normalizeGodotArgsForHost(godotPath, cmdArgs),
          { stdio: 'pipe', windowsHide: true },
        );
        const output: string[] = [];
        const errors: string[] = [];

        proc.stdout?.on('data', (data: Buffer) =>
          output.push(...data.toString().split(/\r?\n/u)),
        );
        proc.stderr?.on('data', (data: Buffer) =>
          errors.push(...data.toString().split(/\r?\n/u)),
        );

        proc.on('exit', () => {
          const current = ctx.getActiveProcess();
          if (current && current.process === proc) ctx.setActiveProcess(null);
        });
        proc.on('error', () => {
          const current = ctx.getActiveProcess();
          if (current && current.process === proc) ctx.setActiveProcess(null);
        });

        const state: GodotProcess = {
          process: proc,
          output,
          errors,
          projectPath,
        };
        ctx.setActiveProcess(state);
        return {
          ok: true,
          summary: 'Godot project started (debug mode)',
          details: { projectPath },
        };
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        return {
          ok: false,
          summary: `Failed to run project: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            suggestions: [
              'Ensure GODOT_PATH is correct',
              'Verify the project contains project.godot',
            ],
          },
        };
      }
    },

    get_debug_output: async (): Promise<ToolResponse> => {
      const current = ctx.getActiveProcess();
      if (!current) {
        return {
          ok: false,
          summary: 'No active Godot process',
          details: { suggestions: ['Use run_project first'] },
        };
      }

      return {
        ok: true,
        summary: 'Collected debug output',
        details: { output: current.output, errors: current.errors },
      };
    },

    stop_project: async (): Promise<ToolResponse> => {
      const current = ctx.getActiveProcess();
      if (!current) {
        return {
          ok: false,
          summary: 'No active Godot process to stop',
          details: { suggestions: ['Use run_project first'] },
        };
      }

      current.process.kill();
      const output = current.output;
      const errors = current.errors;
      ctx.setActiveProcess(null);
      return {
        ok: true,
        summary: 'Godot project stopped',
        details: { finalOutput: output, finalErrors: errors },
      };
    },

    get_godot_version: async (): Promise<ToolResponse> => {
      try {
        const godotPath = await ctx.ensureGodotPath();
        const { stdout, stderr, exitCode } = await execGodot(godotPath, [
          '--version',
        ]);
        if (exitCode !== 0) {
          return {
            ok: false,
            summary: 'Failed to get Godot version',
            details: { exitCode },
            logs: splitLines(stderr),
          };
        }
        return {
          ok: true,
          summary: 'Godot version',
          details: { version: stdout.trim() },
        };
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to get Godot version: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    godot_sync_addon: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      const enablePlugin =
        asOptionalBoolean(argsObj.enablePlugin, 'enablePlugin') ?? true;

      try {
        ctx.assertValidProject(projectPath);

        const srcAddon = path.join(REPO_ROOT, 'addons', 'godot_mcp_bridge');
        const dstAddon = path.join(projectPath, 'addons', 'godot_mcp_bridge');
        const projectGodotPath = path.join(projectPath, 'project.godot');
        const lockPath = path.join(projectPath, '.godot_mcp', 'bridge.lock');

        if (existsSync(lockPath)) {
          return {
            ok: false,
            summary:
              'Editor bridge appears to be running; close the editor before syncing the addon.',
            details: { lockPath },
          };
        }

        const logs: string[] = [];
        logs.push(`Copying addon: ${srcAddon} -> ${dstAddon}`);
        await fs.mkdir(path.dirname(dstAddon), { recursive: true });
        await fs.cp(srcAddon, dstAddon, { recursive: true, force: true });

        let pluginUpdated = false;
        if (enablePlugin) {
          logs.push('Ensuring editor plugin enabled: godot_mcp_bridge');
          const before = await fs.readFile(projectGodotPath, 'utf8');
          const after = ensureEditorPluginEnabled(before, 'godot_mcp_bridge');
          if (after !== normalizeNewlines(before)) {
            await fs.writeFile(projectGodotPath, after, 'utf8');
            pluginUpdated = true;
          }
        }

        return {
          ok: true,
          summary: 'Addon synced to project.',
          details: {
            projectPath,
            addonPath: dstAddon,
            projectGodotPath,
            enablePlugin,
            pluginUpdated,
          },
          logs,
        };
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        return {
          ok: false,
          summary: `Failed to sync addon: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    godot_import_project_assets: async (
      args: unknown,
    ): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      const godotPathArg = normalizeOptionalString(
        asOptionalString(argsObj.godotPath, 'godotPath'),
      );

      try {
        ctx.assertValidProject(projectPath);
        const godotPath = await ctx.ensureGodotPath(godotPathArg);
        const { stdout, stderr, exitCode } = await execGodot(godotPath, [
          '--headless',
          '--path',
          projectPath,
          '--import',
        ]);
        const logs = collectLogs(stdout, stderr);
        if (exitCode !== 0) {
          return {
            ok: false,
            summary: 'Project import failed',
            details: {
              projectPath,
              exitCode,
              suggestions: [
                'Verify your Godot version supports the --import flag.',
                'Open the project once in the editor to trigger imports, then retry.',
                'Ensure GODOT_PATH points to a valid Godot executable.',
              ],
            },
            logs,
          };
        }
        return {
          ok: true,
          summary: 'Project import completed',
          details: { projectPath },
          logs,
        };
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        return {
          ok: false,
          summary: `Failed to import project assets: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            projectPath,
            suggestions: [
              'Ensure the project path is valid and accessible.',
              'Check GODOT_PATH or pass godotPath explicitly.',
            ],
          },
        };
      }
    },

    list_projects: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const directory = asNonEmptyString(argsObj.directory, 'directory');
      const recursive =
        asOptionalBoolean(argsObj.recursive, 'recursive') ?? false;

      try {
        ctx.ensureNoTraversal(directory);
        if (!existsSync(directory)) {
          return {
            ok: false,
            summary: `Directory does not exist: ${directory}`,
          };
        }
        const projects = findGodotProjects(directory, recursive, (m) =>
          ctx.logDebug(m),
        );
        return {
          ok: true,
          summary: `Found ${projects.length} project(s)`,
          details: { projects },
        };
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        return {
          ok: false,
          summary: `Failed to list projects: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    get_project_info: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');

      try {
        ctx.assertValidProject(projectPath);
        const godotPath = await ctx.ensureGodotPath();
        const { stdout: versionStdout } = await execGodot(godotPath, [
          '--version',
        ]);

        const projectFile = path.join(projectPath, 'project.godot');
        let projectName = path.basename(projectPath);
        try {
          const contents = readFileSync(projectFile, 'utf8');
          const match = contents.match(/config\/name="([^"]+)"/u);
          if (match?.[1]) projectName = match[1];
        } catch {
          // ignore
        }

        const structure = await getProjectStructureCounts(projectPath, (m) =>
          ctx.logDebug(m),
        );
        return {
          ok: true,
          summary: 'Project info',
          details: {
            name: projectName,
            path: projectPath,
            godotVersion: versionStdout.trim(),
            structure,
          },
        };
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        return {
          ok: false,
          summary: `Failed to get project info: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
