import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  detectGodotPath,
  GodotPathDetectionError,
  isValidGodotPath,
  normalizeGodotArgsForHost,
  normalizeGodotPathForHost,
} from './godot_cli.js';
import { EditorBridgeClient } from './editor_bridge_client.js';
import { JsonRpcProcessClient } from './utils/jsonrpc_process_client.js';
import { ensureEditorPluginEnabled } from './tools/project.js';

type DoctorGodotDetails = {
  ok: boolean;
  path: string | null;
  origin: 'cli' | 'env' | 'auto' | 'none';
  strictPathValidation: boolean;
  error?: string;
  attemptedCandidates?: { origin: string; candidate: string; valid: boolean }[];
};

type DoctorProjectDetails = {
  ok: boolean;
  path: string;
  projectGodotPath: string;
  hasProjectGodot: boolean;
  hasBridgeAddon: boolean;
  hasBridgePluginEnabled: boolean;
  hasTokenFile: boolean;
  hasPortFile: boolean;
  hasHostFile: boolean;
  error?: string;
};

type DoctorCheckResult = {
  ok: boolean;
  skipped?: boolean;
  summary: string;
  details?: Record<string, unknown>;
  error?: string;
};

type DoctorChecksDetails = {
  projectSetup?: DoctorCheckResult;
  mcpServer?: DoctorCheckResult;
  toolsDoc?: DoctorCheckResult;
  headlessOps?: DoctorCheckResult;
  editorBridge?: DoctorCheckResult;
};

export type DoctorResult = {
  ok: boolean;
  summary: string;
  details: {
    godot: DoctorGodotDetails;
    project?: DoctorProjectDetails;
    checks?: DoctorChecksDetails;
  };
  suggestions: string[];
};

export type DoctorOptions = {
  godotPath?: string;
  projectPath?: string;
  strictPathValidation?: boolean;
  readOnly?: boolean;
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const DOCTOR_FIXTURE_PNG_16X16_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHUlEQVR4nGP8z8Dwn4ECwESJ5lEDRg0YNWAwGQAAWG0CHvXMz6IAAAAASUVORK5CYII=';

function snippet(value: unknown, maxLen = 400): string {
  const text = typeof value === 'string' ? value : String(value);
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProjectPathForCompare(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return '';

  const windowsMatch = trimmed.match(/^([a-zA-Z]):[\\/](.*)$/u);
  const asWsl = windowsMatch
    ? `/mnt/${windowsMatch[1]!.toLowerCase()}/${windowsMatch[2]!.replaceAll('\\', '/')}`
    : trimmed;

  return asWsl.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
}

async function getFreeTcpPort(host = '127.0.0.1'): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() =>
          reject(new Error('Failed to resolve a free TCP port')),
        );
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function generateRandomToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

function parseEditorPluginIds(projectGodotText: string): string[] {
  const plugins: string[] = [];
  const lines = projectGodotText.split(/\r?\n/u);

  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inSection = trimmed === '[editor_plugins]';
      continue;
    }
    if (!inSection) continue;
    if (!trimmed.startsWith('enabled=')) continue;

    for (const match of trimmed.matchAll(/"([^"]+)"/gu)) {
      const pluginId = match[1]?.trim();
      if (pluginId && !plugins.includes(pluginId)) plugins.push(pluginId);
    }
  }

  plugins.sort();
  return plugins;
}

async function resolveGodotDetails(
  options: DoctorOptions,
): Promise<{ details: DoctorGodotDetails; suggestions: string[] }> {
  const suggestions: string[] = [];
  const cache = new Map<string, boolean>();
  const strictPathValidation = options.strictPathValidation === true;

  const fromCli = options.godotPath?.trim();
  if (fromCli) {
    const ok = await isValidGodotPath(fromCli, cache);
    if (ok)
      return {
        details: {
          ok: true,
          path: fromCli,
          origin: 'cli',
          strictPathValidation,
        },
        suggestions,
      };
    suggestions.push(
      `Fix the provided --godot-path (expected '${fromCli} --version' to succeed).`,
    );
    return {
      details: {
        ok: false,
        path: fromCli,
        origin: 'cli',
        strictPathValidation,
        error: `Godot executable is not valid: ${fromCli}`,
      },
      suggestions,
    };
  }

  const fromEnv = process.env.GODOT_PATH?.trim();
  if (fromEnv) {
    const ok = await isValidGodotPath(fromEnv, cache);
    if (ok)
      return {
        details: {
          ok: true,
          path: fromEnv,
          origin: 'env',
          strictPathValidation,
        },
        suggestions,
      };
    suggestions.push(
      `Godot path from GODOT_PATH is invalid: ${fromEnv} (expected '${fromEnv} --version' to succeed)`,
    );
  }

  try {
    const detected = await detectGodotPath({ strictPathValidation });
    const ok = await isValidGodotPath(detected, cache);
    if (!ok) {
      suggestions.push(
        `Auto-detected Godot path is invalid: ${detected} (expected '${detected} --version' to succeed)`,
      );
      suggestions.push(
        'Set GODOT_PATH to a working Godot binary, or pass --godot-path <path>.',
      );
      suggestions.push('Verify it works by running: <godot> --version');
      return {
        details: {
          ok: false,
          path: detected,
          origin: 'auto',
          strictPathValidation,
          error: `Godot executable is not valid: ${detected}`,
        },
        suggestions,
      };
    }

    return {
      details: {
        ok: true,
        path: detected,
        origin: 'auto',
        strictPathValidation,
      },
      suggestions,
    };
  } catch (error) {
    if (error instanceof GodotPathDetectionError) {
      const attemptedCandidates = error.attemptedCandidates.map((a) => ({
        origin: a.origin,
        candidate: a.normalized,
        valid: a.valid,
      }));
      suggestions.push(
        'Set GODOT_PATH to a working Godot binary, or pass --godot-path <path>.',
      );
      suggestions.push('Verify it works by running: <godot> --version');
      return {
        details: {
          ok: false,
          path: null,
          origin: 'none',
          strictPathValidation,
          error: error.message,
          attemptedCandidates,
        },
        suggestions,
      };
    }

    suggestions.push(
      'Set GODOT_PATH to a working Godot binary, or pass --godot-path <path>.',
    );
    suggestions.push('Verify it works by running: <godot> --version');
    const message = error instanceof Error ? error.message : String(error);
    return {
      details: {
        ok: false,
        path: null,
        origin: 'none',
        strictPathValidation,
        error: message,
      },
      suggestions,
    };
  }
}

async function resolveProjectDetails(
  projectPath: string,
): Promise<{ details: DoctorProjectDetails; suggestions: string[] }> {
  const suggestions: string[] = [];
  const absProjectPath = path.resolve(projectPath);

  try {
    const exists = await pathExists(absProjectPath);
    if (!exists) {
      return {
        details: {
          ok: false,
          path: absProjectPath,
          projectGodotPath: path.join(absProjectPath, 'project.godot'),
          hasProjectGodot: false,
          hasBridgeAddon: false,
          hasBridgePluginEnabled: false,
          hasTokenFile: false,
          hasPortFile: false,
          hasHostFile: false,
          error: `Project path does not exist: ${absProjectPath}`,
        },
        suggestions: [
          `Pass a valid Godot project root containing project.godot (got: ${absProjectPath}).`,
        ],
      };
    }

    const projectGodotPath = path.join(absProjectPath, 'project.godot');
    const hasProjectGodot = await pathExists(projectGodotPath);

    const bridgeAddonPath = path.join(
      absProjectPath,
      'addons',
      'godot_mcp_bridge',
    );
    const hasBridgeAddon = await pathExists(bridgeAddonPath);

    let hasBridgePluginEnabled = false;
    if (hasProjectGodot) {
      try {
        const raw = await fs.readFile(projectGodotPath, 'utf8');
        const enabled = parseEditorPluginIds(raw);
        hasBridgePluginEnabled = enabled.includes('godot_mcp_bridge');
      } catch {
        // ignore; keep false
      }
    }

    const tokenPath = path.join(absProjectPath, '.godot_mcp_token');
    const hasTokenFile = await pathExists(tokenPath);

    const portPath = path.join(absProjectPath, '.godot_mcp_port');
    const hasPortFile = await pathExists(portPath);

    const hostPath = path.join(absProjectPath, '.godot_mcp_host');
    const hasHostFile = await pathExists(hostPath);

    if (!hasProjectGodot) {
      suggestions.push(
        `Missing project.godot at: ${projectGodotPath} (pass the Godot project root).`,
      );
    }

    if (!hasBridgeAddon) {
      suggestions.push(
        `Missing editor bridge addon at: ${bridgeAddonPath} (non-fatal).`,
      );
      suggestions.push(
        `To install/sync it: npm run sync:addon -- --project ${absProjectPath}`,
      );
    }

    if (hasBridgeAddon && !hasBridgePluginEnabled) {
      suggestions.push(
        'Bridge addon is present but editor plugin is not enabled in project.godot (non-fatal).',
      );
      suggestions.push(
        `Enable it by adding [editor_plugins] enabled=PackedStringArray(\"godot_mcp_bridge\") in ${projectGodotPath}`,
      );
    }

    if (!hasTokenFile) {
      suggestions.push(
        `Missing .godot_mcp_token at: ${tokenPath} (non-fatal).`,
      );
      suggestions.push(`Create it with any random string token.`);
    }

    if (!hasPortFile) {
      suggestions.push(`Missing .godot_mcp_port at: ${portPath} (non-fatal).`);
      suggestions.push(`(Optional) Create it with a port number like 8765.`);
    }

    if (!hasHostFile) {
      suggestions.push(`Missing .godot_mcp_host at: ${hostPath} (non-fatal).`);
      suggestions.push(
        `(Optional) Create it with a host value like 127.0.0.1.`,
      );
    }

    return {
      details: {
        ok: hasProjectGodot,
        path: absProjectPath,
        projectGodotPath,
        hasProjectGodot,
        hasBridgeAddon,
        hasBridgePluginEnabled,
        hasTokenFile,
        hasPortFile,
        hasHostFile,
      },
      suggestions,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      details: {
        ok: false,
        path: absProjectPath,
        projectGodotPath: path.join(absProjectPath, 'project.godot'),
        hasProjectGodot: false,
        hasBridgeAddon: false,
        hasBridgePluginEnabled: false,
        hasTokenFile: false,
        hasPortFile: false,
        hasHostFile: false,
        error: message,
      },
      suggestions: [`Failed to check project: ${message}`],
    };
  }
}

async function runProjectSetupForEditorBridge(
  projectPath: string,
  opts: { readOnly: boolean },
): Promise<DoctorCheckResult> {
  const absProjectPath = path.resolve(projectPath);
  const projectGodotPath = path.join(absProjectPath, 'project.godot');
  const lockFilePath = path.join(absProjectPath, '.godot_mcp', 'bridge.lock');

  const hasProjectGodot = await pathExists(projectGodotPath);
  if (!hasProjectGodot) {
    return {
      ok: false,
      summary: 'Project setup failed (missing project.godot)',
      details: { projectPath: absProjectPath, projectGodotPath },
    };
  }

  const lockFileExists = await pathExists(lockFilePath);

  if (opts.readOnly) {
    const dstAddonPath = path.join(
      absProjectPath,
      'addons',
      'godot_mcp_bridge',
    );
    const dstPluginCfgPath = path.join(dstAddonPath, 'plugin.cfg');
    const dstAddonOk = await pathExists(dstPluginCfgPath);

    let pluginEnabled = false;
    let enabledPlugins: string[] = [];
    try {
      const projectGodotText = await fs.readFile(projectGodotPath, 'utf8');
      enabledPlugins = parseEditorPluginIds(projectGodotText);
      pluginEnabled = enabledPlugins.includes('godot_mcp_bridge');
    } catch {
      // ignore; keep false
    }

    const tokenPath = path.join(absProjectPath, '.godot_mcp_token');
    let tokenPresent = false;
    try {
      tokenPresent = Boolean((await fs.readFile(tokenPath, 'utf8')).trim());
    } catch {
      tokenPresent = false;
    }

    const needsChanges = !dstAddonOk || !pluginEnabled || !tokenPresent;

    return {
      ok: true,
      skipped: true,
      summary: needsChanges
        ? 'Project setup skipped (read-only mode; changes needed)'
        : 'Project already set up (read-only mode)',
      details: {
        projectPath: absProjectPath,
        lockFileExists,
        addonPresent: dstAddonOk,
        pluginEnabled,
        enabledPlugins,
        tokenPresent,
        tokenPath,
        suggestions: [
          'Read-only mode: no project files were modified.',
          'Re-run without --doctor-readonly to apply addon/plugin/token automatically.',
          !dstAddonOk
            ? `Missing addon: ${dstAddonPath} (run: npm run sync:addon -- --project ${absProjectPath})`
            : null,
          !pluginEnabled
            ? `Enable plugin in ${projectGodotPath}: [editor_plugins] enabled=PackedStringArray("godot_mcp_bridge")`
            : null,
          !tokenPresent
            ? `Create ${tokenPath} with any random string token.`
            : null,
          lockFileExists
            ? 'If the editor is running, close it before applying setup changes.'
            : null,
        ].filter(Boolean),
      },
    };
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageRoot = path.resolve(__dirname, '..');

  const srcAddonPath = path.join(packageRoot, 'addons', 'godot_mcp_bridge');
  const srcAddonExists = await pathExists(srcAddonPath);
  if (!srcAddonExists) {
    return {
      ok: false,
      summary: 'Project setup failed (bridge addon source is missing)',
      details: {
        projectPath: absProjectPath,
        srcAddonPath,
        suggestions: [
          'Run doctor from the repository checkout that contains addons/godot_mcp_bridge.',
          'Or sync the addon manually into the project.',
        ],
      },
    };
  }

  const dstAddonPath = path.join(absProjectPath, 'addons', 'godot_mcp_bridge');
  const dstPluginCfgPath = path.join(dstAddonPath, 'plugin.cfg');
  const dstAddonOk = await pathExists(dstPluginCfgPath);

  let addonCopied = false;
  if (!dstAddonOk) {
    if (lockFileExists) {
      return {
        ok: false,
        summary:
          'Project setup failed (cannot sync addon while editor bridge is running)',
        details: {
          lockFilePath,
          suggestions: [
            'Close Godot editor for this project, then re-run --doctor.',
          ],
        },
      };
    }

    await fs.mkdir(path.dirname(dstAddonPath), { recursive: true });
    await fs.cp(srcAddonPath, dstAddonPath, { recursive: true, force: true });
    addonCopied = true;
  }

  const normalizeNewlines = (text: string) => text.replace(/\r\n/gu, '\n');

  const beforeProjectGodot = await fs.readFile(projectGodotPath, 'utf8');
  const afterProjectGodot = ensureEditorPluginEnabled(
    beforeProjectGodot,
    'godot_mcp_bridge',
  );

  let pluginEnabledUpdated = false;
  if (afterProjectGodot !== normalizeNewlines(beforeProjectGodot)) {
    if (lockFileExists) {
      return {
        ok: false,
        summary:
          'Project setup failed (cannot update project.godot while editor is running)',
        details: {
          lockFilePath,
          projectGodotPath,
          suggestions: [
            'Close Godot editor for this project, then re-run --doctor.',
          ],
        },
      };
    }
    await fs.writeFile(projectGodotPath, afterProjectGodot, 'utf8');
    pluginEnabledUpdated = true;
  }

  const tokenPath = path.join(absProjectPath, '.godot_mcp_token');
  let token = '';
  try {
    token = (await fs.readFile(tokenPath, 'utf8')).trim();
  } catch {
    // ignore
  }

  let tokenCreated = false;
  if (!token) {
    if (lockFileExists) {
      return {
        ok: false,
        summary:
          'Project setup failed (token missing but editor bridge appears running)',
        details: {
          lockFilePath,
          tokenPath,
          suggestions: [
            'Set GODOT_MCP_TOKEN in the editor environment, or create .godot_mcp_token and restart the editor.',
          ],
        },
      };
    }
    token = generateRandomToken();
    await fs.writeFile(tokenPath, `${token}\n`, 'utf8');
    tokenCreated = true;
  }

  const changed = addonCopied || pluginEnabledUpdated || tokenCreated;
  return {
    ok: true,
    summary: changed
      ? 'Project setup applied (addon/plugin/token)'
      : 'Project already set up (addon/plugin/token)',
    details: {
      projectPath: absProjectPath,
      lockFileExists,
      addonCopied,
      pluginEnabledUpdated,
      tokenCreated,
      addonPath: dstAddonPath,
      projectGodotPath,
      tokenPath,
    },
  };
}

async function runToolsDocDriftCheck(): Promise<DoctorCheckResult> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageRoot = path.resolve(__dirname, '..');

  const toolsDocPath = path.join(packageRoot, 'docs', 'TOOLS.md');
  const generatorPath = path.join(
    packageRoot,
    'scripts',
    'generate_tools_md.js',
  );

  const [hasToolsDoc, hasGenerator] = await Promise.all([
    pathExists(toolsDocPath),
    pathExists(generatorPath),
  ]);

  if (!hasToolsDoc || !hasGenerator) {
    return {
      ok: true,
      skipped: true,
      summary: 'Tools doc drift check skipped',
      details: {
        reason: 'docs/TOOLS.md or scripts/generate_tools_md.js not found',
        hasToolsDoc,
        hasGenerator,
      },
    };
  }

  return await new Promise<DoctorCheckResult>((resolve) => {
    const child = spawn(process.execPath, [generatorPath, '--check'], {
      cwd: packageRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));

    const timeoutMs = 30_000;
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({
        ok: false,
        summary: 'Tools doc drift check timed out',
        error: `Timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({
          ok: true,
          summary: 'docs/TOOLS.md is up to date',
          details: { output: snippet(stdout, 800) },
        });
        return;
      }
      resolve({
        ok: false,
        summary: 'docs/TOOLS.md is out of date (or verification failed)',
        error:
          snippet(stderr || stdout, 1200) || `Exit code: ${code ?? 'null'}`,
        details: {
          exitCode: code,
          suggestion: 'Run: cd godot-mcp-omni && npm run docs:tools',
        },
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        summary: 'Tools doc drift check failed to start',
        error: snippet(err instanceof Error ? err.message : String(err)),
      });
    });
  });
}

async function createTempProject(): Promise<{
  workspaceRoot: string;
  projectPath: string;
}> {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'godot-mcp-omni-doctor-'),
  );
  const projectPath = path.join(workspaceRoot, 'DoctorProject');
  await fs.mkdir(projectPath, { recursive: true });

  const projectGodot = [
    '; Engine configuration file.',
    "; It's best edited using the editor UI and not directly.",
    'config_version=5',
    '',
    '[application]',
    'config/name="godot-mcp-omni-doctor"',
    '',
  ].join('\n');

  await fs.writeFile(
    path.join(projectPath, 'project.godot'),
    projectGodot,
    'utf8',
  );

  return { workspaceRoot, projectPath };
}

async function writeHeadlessDoctorFixtures(projectPath: string): Promise<{
  doctorDir: string;
  atlasPngResPath: string;
  spriteSheetPngResPath: string;
  asepriteJsonResPath: string;
  receiverScriptResPath: string;
  meshSceneResPath: string;
}> {
  const doctorDir = path.join(projectPath, '.godot_mcp', 'doctor');
  await fs.mkdir(doctorDir, { recursive: true });

  const pngBytes = Buffer.from(DOCTOR_FIXTURE_PNG_16X16_BASE64, 'base64');
  const atlasPngAbsPath = path.join(doctorDir, 'atlas.png');
  const spriteSheetPngAbsPath = path.join(doctorDir, 'spritesheet.png');
  await fs.writeFile(atlasPngAbsPath, pngBytes);
  await fs.writeFile(spriteSheetPngAbsPath, pngBytes);

  const asepriteJsonAbsPath = path.join(doctorDir, 'aseprite.json');
  const asepriteJson = {
    frames: [{ frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 }],
    meta: {
      frameTags: [{ name: 'idle', from: 0, to: 0, direction: 'forward' }],
    },
  };
  await fs.writeFile(
    asepriteJsonAbsPath,
    `${JSON.stringify(asepriteJson, null, 2)}\n`,
    'utf8',
  );

  const receiverScriptAbsPath = path.join(doctorDir, 'receiver.gd');
  const receiverScript = [
    'extends Node',
    '',
    'func on_timeout() -> void:',
    '\tpass',
    '',
  ].join('\n');
  await fs.writeFile(receiverScriptAbsPath, receiverScript, 'utf8');

  const meshSceneAbsPath = path.join(doctorDir, 'MeshScene.tscn');
  const meshScene = [
    '[gd_scene load_steps=2 format=3]',
    '',
    '[sub_resource type="BoxMesh" id=1]',
    '',
    '[node name="Root" type="Node3D"]',
    '[node name="Cube" type="MeshInstance3D" parent="."]',
    'mesh = SubResource(1)',
    '',
  ].join('\n');
  await fs.writeFile(meshSceneAbsPath, meshScene, 'utf8');

  const atlasPngResPath = '.godot_mcp/doctor/atlas.png';
  const spriteSheetPngResPath = '.godot_mcp/doctor/spritesheet.png';
  const asepriteJsonResPath = '.godot_mcp/doctor/aseprite.json';
  const receiverScriptResPath = '.godot_mcp/doctor/receiver.gd';
  const meshSceneResPath = '.godot_mcp/doctor/MeshScene.tscn';

  return {
    doctorDir,
    atlasPngResPath,
    spriteSheetPngResPath,
    asepriteJsonResPath,
    receiverScriptResPath,
    meshSceneResPath,
  };
}

async function isNonEmptyFile(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function runMcpServerAndHeadlessChecks(args: {
  godotPath: string | null;
}): Promise<{ mcpServer: DoctorCheckResult; headlessOps: DoctorCheckResult }> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageRoot = path.resolve(__dirname, '..');
  const serverEntry = path.join(packageRoot, 'build', 'index.js');

  const serverEntryExists = await pathExists(serverEntry);
  if (!serverEntryExists) {
    return {
      mcpServer: {
        ok: false,
        summary: 'MCP server self-test failed',
        error: `Missing build entry: ${serverEntry}`,
        details: { suggestion: 'Run: cd godot-mcp-omni && npm run build' },
      },
      headlessOps: {
        ok: true,
        skipped: true,
        summary: 'Headless ops smoke test skipped',
        details: {
          reason: 'MCP server self-test failed (server not available)',
        },
      },
    };
  }

  const mergedEnv = { ...process.env };
  if (args.godotPath) mergedEnv.GODOT_PATH = args.godotPath;
  // Doctor headless verification runs against a temporary project only; enable
  // gated ops (e.g., resave_resources/export_mesh_library) inside that sandbox.
  mergedEnv.ALLOW_DANGEROUS_OPS = 'true';

  const server = spawn(process.execPath, [serverEntry], {
    cwd: packageRoot,
    env: mergedEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const client = new JsonRpcProcessClient(server);

  try {
    const started = Date.now();

    let toolCount: number | null = null;
    try {
      const resp = await client.send('tools/list', {}, 10_000);
      if ('error' in resp) {
        throw new Error(`tools/list error: ${snippet(resp.error)}`);
      }
      const result = resp.result as unknown;
      if (
        !result ||
        typeof result !== 'object' ||
        Array.isArray(result) ||
        !('tools' in result)
      ) {
        throw new Error(
          `tools/list returned unexpected result: ${snippet(result)}`,
        );
      }
      const tools = (result as Record<string, unknown>).tools;
      toolCount = Array.isArray(tools) ? tools.length : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        mcpServer: {
          ok: false,
          summary: 'MCP server self-test failed (tools/list)',
          error: message,
        },
        headlessOps: {
          ok: true,
          skipped: true,
          summary: 'Headless ops smoke test skipped',
          details: { reason: 'MCP server self-test failed' },
        },
      };
    }

    const mcpServer: DoctorCheckResult = {
      ok: true,
      summary: 'MCP server self-test OK (tools/list)',
      details: {
        toolCount,
        durationMs: Date.now() - started,
      },
    };

    if (!args.godotPath) {
      return {
        mcpServer,
        headlessOps: {
          ok: true,
          skipped: true,
          summary: 'Headless ops smoke test skipped',
          details: { reason: 'Godot executable not available' },
        },
      };
    }

    const { workspaceRoot, projectPath } = await createTempProject();
    try {
      const fixtures = await writeHeadlessDoctorFixtures(projectPath);

      const mapSize = { width: 8, height: 8 };
      const tileMapping = {
        grass: { x: 0, y: 0 },
        forest: { x: 0, y: 0 },
        water: { x: 0, y: 0 },
        path: { x: 0, y: 0 },
        cliff: { x: 0, y: 0 },
      };

      await client.callToolOrThrow(
        'godot_headless_batch',
        {
          projectPath,
          stopOnError: true,
          steps: [
            // File ops
            {
              operation: 'write_text_file',
              params: {
                path: '.godot_mcp/doctor/notes.txt',
                content: 'doctor: ok\n',
              },
            },
            {
              operation: 'read_text_file',
              params: { path: '.godot_mcp/doctor/notes.txt' },
            },

            // Resource ops
            { operation: 'get_godot_version', params: {} },
            {
              operation: 'create_resource',
              params: {
                resource_path: '.godot_mcp/doctor/BoxMesh.tres',
                type: 'BoxMesh',
              },
            },
            {
              operation: 'get_uid',
              params: { file_path: '.godot_mcp/doctor/BoxMesh.tres' },
            },

            // Scene ops: create + edit + connect_signal + save/validate/instance
            {
              operation: 'create_scene',
              params: {
                scene_path: '.godot_mcp/doctor/Main.tscn',
                root_node_type: 'Node2D',
              },
            },
            {
              operation: 'add_node',
              params: {
                scene_path: '.godot_mcp/doctor/Main.tscn',
                parent_node_path: 'root',
                node_type: 'Timer',
                node_name: 'Timer',
              },
            },
            {
              operation: 'add_node',
              params: {
                scene_path: '.godot_mcp/doctor/Main.tscn',
                parent_node_path: 'root',
                node_type: 'Node',
                node_name: 'Receiver',
              },
            },
            {
              operation: 'attach_script',
              params: {
                scene_path: '.godot_mcp/doctor/Main.tscn',
                node_path: 'root/Receiver',
                script_path: fixtures.receiverScriptResPath,
              },
            },
            {
              operation: 'connect_signal',
              params: {
                scene_path: '.godot_mcp/doctor/Main.tscn',
                from_node_path: 'root/Timer',
                signal: 'timeout',
                to_node_path: 'root/Receiver',
                method: 'on_timeout',
              },
            },
            {
              operation: 'set_node_properties',
              params: {
                scene_path: '.godot_mcp/doctor/Main.tscn',
                node_path: 'root/Timer',
                props: { wait_time: 0.1, one_shot: true },
              },
            },
            {
              operation: 'validate_scene',
              params: { scene_path: '.godot_mcp/doctor/Main.tscn' },
            },
            {
              operation: 'save_scene',
              params: {
                scene_path: '.godot_mcp/doctor/Main.tscn',
                new_path: '.godot_mcp/doctor/MainCopy.tscn',
              },
            },
            {
              operation: 'create_scene',
              params: {
                scene_path: '.godot_mcp/doctor/ChildScene.tscn',
                root_node_type: 'Node2D',
              },
            },
            {
              operation: 'instance_scene',
              params: {
                scene_path: '.godot_mcp/doctor/Main.tscn',
                source_scene_path: '.godot_mcp/doctor/ChildScene.tscn',
                parent_node_path: 'root',
                ensure_unique_name: true,
              },
            },
            {
              operation: 'create_node_bundle',
              params: {
                scene_path: '.godot_mcp/doctor/Main.tscn',
                parent_node_path: 'root',
                node_type: 'Node2D',
                node_name: 'Bundle',
                children: [
                  {
                    node_type: 'Node2D',
                    node_name: 'Inner',
                  },
                ],
              },
            },
            {
              operation: 'create_tilemap',
              params: {
                scene_path: '.godot_mcp/doctor/Main.tscn',
                parent_node_path: 'root',
                node_name: 'TileMap',
                tile_set_texture_path: fixtures.atlasPngResPath,
                tile_set_path: '.godot_mcp/doctor/TileMapTileset.tres',
                tile_size: { x: 16, y: 16 },
                cells: [
                  {
                    x: 0,
                    y: 0,
                    source_id: -1,
                    atlas_x: 0,
                    atlas_y: 0,
                    alternative: 0,
                  },
                ],
              },
            },

            // Resource ops: load_sprite (requires a Sprite scene)
            {
              operation: 'create_scene',
              params: {
                scene_path: '.godot_mcp/doctor/SpriteScene.tscn',
                root_node_type: 'Node2D',
              },
            },
            {
              operation: 'add_node',
              params: {
                scene_path: '.godot_mcp/doctor/SpriteScene.tscn',
                parent_node_path: 'root',
                node_type: 'Sprite2D',
                node_name: 'Sprite',
              },
            },
            {
              operation: 'load_sprite',
              params: {
                scene_path: '.godot_mcp/doctor/SpriteScene.tscn',
                node_path: 'root/Sprite',
                texture_path: fixtures.atlasPngResPath,
              },
            },

            // Resource ops (gated): export_mesh_library
            {
              operation: 'export_mesh_library',
              params: {
                scene_path: fixtures.meshSceneResPath,
                output_path: '.godot_mcp/doctor/MeshLibrary.tres',
              },
            },

            // Pixel ops: tileset + world + objects + preview
            {
              operation: 'op_tileset_create_from_atlas',
              params: {
                png_path: fixtures.atlasPngResPath,
                output_tileset_path: '.godot_mcp/doctor/AtlasTileset.tres',
                tile_size: 16,
              },
            },
            {
              operation: 'op_world_scene_ensure_layers',
              params: {
                scene_path: '.godot_mcp/doctor/World.tscn',
                tileset_path: '.godot_mcp/doctor/AtlasTileset.tres',
              },
            },
            {
              operation: 'op_world_generate_tiles',
              params: {
                scene_path: '.godot_mcp/doctor/World.tscn',
                layer_name: 'Terrain',
                map_size: mapSize,
                tile_mapping: tileMapping,
                source_id: 0,
              },
            },
            {
              operation: 'op_place_objects_tile',
              params: {
                scene_path: '.godot_mcp/doctor/World.tscn',
                map_size: mapSize,
                objects: [{ id: 'rock', density: 0.25, atlas: { x: 0, y: 0 } }],
                source_id: 0,
              },
            },
            {
              operation: 'create_scene',
              params: {
                scene_path: '.godot_mcp/doctor/Object.tscn',
                root_node_type: 'Node2D',
              },
            },
            {
              operation: 'op_place_objects_scene_instances',
              params: {
                scene_path: '.godot_mcp/doctor/World.tscn',
                parent_node_path: 'root/Interactive',
                map_size: mapSize,
                tile_size: 16,
                objects: [
                  {
                    id: 'tree',
                    scene_path: '.godot_mcp/doctor/Object.tscn',
                    count: 3,
                  },
                ],
              },
            },
            {
              operation: 'op_export_preview',
              params: {
                scene_path: '.godot_mcp/doctor/World.tscn',
                output_png_path: '.godot_mcp/doctor/Preview.png',
                map_size: mapSize,
                tile_mapping: tileMapping,
              },
            },

            // Pixel ops: SpriteFrames from Aseprite JSON
            {
              operation: 'op_spriteframes_from_aseprite_json',
              params: {
                spritesheet_png_path: fixtures.spriteSheetPngResPath,
                aseprite_json_path: fixtures.asepriteJsonResPath,
                sprite_frames_path: '.godot_mcp/doctor/SpriteFrames.tres',
                fps: 8,
                loop: true,
              },
            },

            // Doctor scan (headless)
            {
              operation: 'doctor_scan_v1',
              params: {
                time_budget_ms: 60_000,
                include_assets: false,
                include_scripts: true,
                include_scenes: true,
                include_uid: true,
                deep_scene_instantiate: false,
                max_issues_per_category: 50,
              },
            },

            // Resource ops (gated): resave_resources
            {
              operation: 'resave_resources',
              params: { project_path: 'res://.godot_mcp/doctor' },
            },
          ],
        },
        60_000,
      );

      const expectedTextFiles = [
        path.join(fixtures.doctorDir, 'notes.txt'),
        path.join(fixtures.doctorDir, 'Main.tscn'),
        path.join(fixtures.doctorDir, 'MainCopy.tscn'),
        path.join(fixtures.doctorDir, 'ChildScene.tscn'),
        path.join(fixtures.doctorDir, 'SpriteScene.tscn'),
        path.join(fixtures.doctorDir, 'Object.tscn'),
        path.join(fixtures.doctorDir, 'BoxMesh.tres'),
        path.join(fixtures.doctorDir, 'MeshLibrary.tres'),
        path.join(fixtures.doctorDir, 'AtlasTileset.tres'),
        path.join(fixtures.doctorDir, 'World.tscn'),
        path.join(fixtures.doctorDir, 'SpriteFrames.tres'),
        path.join(fixtures.doctorDir, 'TileMapTileset.tres'),
      ];
      const expectedBinaryFiles = [
        path.join(fixtures.doctorDir, 'Preview.png'),
      ];

      const [textExists, binaryExists] = await Promise.all([
        Promise.all(expectedTextFiles.map((p) => pathExists(p))),
        Promise.all(expectedBinaryFiles.map((p) => isNonEmptyFile(p))),
      ]);

      const missingText = expectedTextFiles.filter((_, i) => !textExists[i]);
      const missingBinary = expectedBinaryFiles.filter(
        (_, i) => !binaryExists[i],
      );
      const missing = [...missingText, ...missingBinary];

      return {
        mcpServer,
        headlessOps: {
          ok: missing.length === 0,
          summary:
            missing.length === 0
              ? 'Headless ops verification OK (all ops)'
              : 'Headless ops smoke test failed (outputs missing)',
          details: {
            projectPath,
            verifiedOps: [
              'read_text_file',
              'write_text_file',
              'create_scene',
              'add_node',
              'create_node_bundle',
              'instance_scene',
              'create_tilemap',
              'save_scene',
              'validate_scene',
              'set_node_properties',
              'connect_signal',
              'attach_script',
              'get_godot_version',
              'load_sprite',
              'create_resource',
              'export_mesh_library',
              'get_uid',
              'resave_resources',
              'op_tileset_create_from_atlas',
              'op_world_scene_ensure_layers',
              'op_world_generate_tiles',
              'op_place_objects_tile',
              'op_place_objects_scene_instances',
              'op_export_preview',
              'op_spriteframes_from_aseprite_json',
              'doctor_scan_v1',
            ],
            expectedOutputs: [...expectedTextFiles, ...expectedBinaryFiles].map(
              (p) => path.relative(projectPath, p),
            ),
            missingOutputs: missing.map((p) => path.relative(projectPath, p)),
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        mcpServer,
        headlessOps: {
          ok: false,
          summary: 'Headless ops smoke test failed',
          error: snippet(message, 1200),
          details: {
            suggestion:
              'Run: cd godot-mcp-omni && node scripts/run_with_godot.js npm test',
          },
        },
      };
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  } finally {
    client.dispose();
    try {
      server.kill();
    } catch {
      // ignore
    }
  }
}

async function runEditorBridgeCheck(args: {
  projectPath: string | undefined;
  godotPath: string | null;
  readOnly: boolean;
}): Promise<DoctorCheckResult> {
  if (!args.projectPath) {
    return {
      ok: true,
      skipped: true,
      summary: 'Editor bridge check skipped',
      details: {
        reason: 'Pass --project <path> to enable editor bridge checks',
      },
    };
  }

  const absProjectPath = path.resolve(args.projectPath);
  const projectGodotPath = path.join(absProjectPath, 'project.godot');

  let projectGodotText = '';
  try {
    projectGodotText = await fs.readFile(projectGodotPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      summary: 'Editor bridge check failed (cannot read project.godot)',
      error: snippet(error instanceof Error ? error.message : String(error)),
      details: { projectGodotPath },
    };
  }

  const enabledPlugins = parseEditorPluginIds(projectGodotText);
  const pluginEnabled = enabledPlugins.includes('godot_mcp_bridge');

  const lockFilePath = path.join(absProjectPath, '.godot_mcp', 'bridge.lock');
  const lockFileExists = await pathExists(lockFilePath);

  const portFilePath = path.join(absProjectPath, '.godot_mcp_port');
  const hostFilePath = path.join(absProjectPath, '.godot_mcp_host');
  const tokenFilePath = path.join(absProjectPath, '.godot_mcp_token');

  const envHost = (process.env.GODOT_MCP_HOST ?? '').trim();
  const envPortRaw = (process.env.GODOT_MCP_PORT ?? '').trim();
  const envPort = Number.parseInt(envPortRaw, 10);
  const hostFromEnv = envHost.length > 0 ? envHost : undefined;
  const portFromEnv =
    Number.isInteger(envPort) && envPort > 0 ? envPort : undefined;

  let hostFromFile: string | undefined;
  try {
    hostFromFile =
      (await fs.readFile(hostFilePath, 'utf8')).trim() || undefined;
  } catch {
    // ignore
  }

  let portFromFile: number | undefined;
  try {
    const raw = (await fs.readFile(portFilePath, 'utf8')).trim();
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) portFromFile = parsed;
  } catch {
    // ignore
  }

  const host = hostFromEnv ?? hostFromFile ?? '127.0.0.1';
  const port = portFromEnv ?? portFromFile ?? 8765;

  const envToken = (process.env.GODOT_MCP_TOKEN ?? '').trim();
  let tokenFromFile = '';
  try {
    tokenFromFile = (await fs.readFile(tokenFilePath, 'utf8')).trim();
  } catch {
    // ignore
  }
  const token = envToken || tokenFromFile;
  const tokenSource = envToken ? 'env' : tokenFromFile ? 'file' : 'none';

  if (!pluginEnabled) {
    return {
      ok: false,
      summary: 'Editor bridge plugin is not enabled',
      details: {
        projectGodotPath,
        enabledPlugins,
        suggestions: [
          'Enable the plugin in project.godot: [editor_plugins] enabled=PackedStringArray("godot_mcp_bridge")',
          'Or enable it in Godot editor: Project Settings → Plugins',
        ],
      },
    };
  }

  if (!token) {
    return {
      ok: false,
      summary: 'Editor bridge token is missing/empty',
      details: {
        lockFilePath,
        tokenSource,
        suggestions: [
          'Set GODOT_MCP_TOKEN, or create <project>/.godot_mcp_token with a random string token.',
        ],
      },
    };
  }

  const expectedProjectRoot = normalizeProjectPathForCompare(absProjectPath);

  const extractProjectRoot = (health: unknown): string | undefined => {
    if (
      !health ||
      typeof health !== 'object' ||
      Array.isArray(health) ||
      typeof (health as { ok?: unknown }).ok !== 'boolean'
    ) {
      return undefined;
    }

    const response = health as { ok: boolean; result?: unknown };
    if (!response.ok) return undefined;
    const result = response.result;
    if (!result || typeof result !== 'object' || Array.isArray(result))
      return undefined;
    const root = (result as { project_root?: unknown }).project_root;
    return typeof root === 'string' ? root : undefined;
  };

  const verifyConnectedHealth = async (
    effectiveHost: string,
    effectivePort: number,
    timeoutLabel: string,
    timeouts: { connectMs: number; healthMs: number } = {
      connectMs: 1500,
      healthMs: 3000,
    },
  ): Promise<DoctorCheckResult> => {
    const client = new EditorBridgeClient();
    try {
      await client.connect({
        host: effectiveHost,
        port: effectivePort,
        token,
        timeoutMs: timeouts.connectMs,
      });
      const health = await client.request('health', {}, timeouts.healthMs);
      if (!health.ok) {
        return {
          ok: false,
          summary: 'Editor bridge connected but health RPC failed',
          details: {
            host: effectiveHost,
            port: effectivePort,
            tokenSource,
            lockFilePath,
            health,
          },
        };
      }

      const reportedRoot = extractProjectRoot(health);
      if (reportedRoot) {
        const normalized = normalizeProjectPathForCompare(reportedRoot);
        if (normalized && normalized !== expectedProjectRoot) {
          return {
            ok: false,
            summary: 'Editor bridge health returned a different project_root',
            details: {
              host: effectiveHost,
              port: effectivePort,
              tokenSource,
              lockFilePath,
              expectedProjectRoot: absProjectPath,
              reportedProjectRoot: reportedRoot,
              timeout: timeoutLabel,
            },
          };
        }
      }

      return {
        ok: true,
        summary: 'Editor bridge OK (connect + health)',
        details: {
          host: effectiveHost,
          port: effectivePort,
          tokenSource,
          lockFilePath,
          timeout: timeoutLabel,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        summary: 'Editor bridge check failed (connect/hello/health)',
        error: snippet(message, 1200),
        details: {
          host: effectiveHost,
          port: effectivePort,
          tokenSource,
          lockFilePath,
          timeout: timeoutLabel,
        },
      };
    } finally {
      client.close();
    }
  };

  let shouldCleanLockFile = !lockFileExists;
  if (lockFileExists) {
    const candidates: { label: string; host: string; port: number }[] = [];
    const seen = new Set<string>();
    const addCandidate = (
      label: string,
      candidateHost: string,
      candidatePort: number,
    ) => {
      const key = `${candidateHost}:${candidatePort}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ label, host: candidateHost, port: candidatePort });
    };

    addCandidate('configured', host, port);
    addCandidate('file', hostFromFile ?? '127.0.0.1', portFromFile ?? 8765);
    addCandidate('default', '127.0.0.1', 8765);

    let lastAttempt: DoctorCheckResult | undefined;
    for (const candidate of candidates) {
      lastAttempt = await verifyConnectedHealth(
        candidate.host,
        candidate.port,
        `existing:${candidate.label}`,
      );
      if (lastAttempt.ok) return lastAttempt;
    }

    const lastError = (lastAttempt?.error ?? '').toLowerCase();
    const looksLikeStaleLock =
      lastError.includes('econnrefused') ||
      lastError.includes('connect timeout');

    if (!args.godotPath) {
      return {
        ok: false,
        summary:
          'Editor bridge lock file is present but the bridge is not reachable',
        error: lastAttempt?.error,
        details: {
          lockFilePath,
          tried: candidates,
          lastAttempt,
          suggestion: looksLikeStaleLock
            ? 'If the editor is not running, delete the stale lock file and re-run --doctor.'
            : 'Check the token/host/port configuration for the running editor.',
        },
      };
    }

    if (!looksLikeStaleLock) {
      return {
        ok: false,
        summary:
          'Editor bridge lock file is present but the bridge could not be validated',
        error: lastAttempt?.error,
        details: {
          lockFilePath,
          tried: candidates,
          lastAttempt,
          suggestion:
            'Lock file suggests the editor bridge is running; fix token/host/port and retry.',
        },
      };
    }

    if (args.readOnly) {
      return {
        ok: false,
        summary:
          'Editor bridge lock file appears stale, but read-only mode prevents cleanup/auto-launch',
        error: lastAttempt?.error,
        details: {
          lockFilePath,
          tried: candidates,
          lastAttempt,
          suggestion:
            'Delete the stale lock file manually, or re-run --doctor without --doctor-readonly to let it clean and auto-launch the editor.',
        },
      };
    }

    // Likely stale lock file: remove and attempt auto-launch.
    try {
      await fs.rm(lockFilePath, { force: true });
      shouldCleanLockFile = true;
    } catch {
      // ignore
    }
  }

  if (!args.godotPath) {
    return {
      ok: true,
      skipped: true,
      summary: 'Editor bridge auto-launch skipped (Godot path unavailable)',
      details: {
        lockFilePath,
        tokenSource,
        suggestions: [
          'Provide a working GODOT_PATH / --godot-path to let --doctor auto-launch the editor and verify the bridge.',
        ],
      },
    };
  }

  if (args.readOnly) {
    return {
      ok: true,
      skipped: true,
      summary: 'Editor bridge auto-launch skipped (read-only mode)',
      details: {
        lockFilePath,
        tokenSource,
        suggestions: [
          'Read-only mode: not auto-launching the editor and not writing host/port files.',
          'Start the editor manually (or re-run --doctor without --doctor-readonly) to validate the bridge connection.',
        ],
      },
    };
  }

  const isWsl =
    process.platform === 'linux' &&
    Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
  const isWindowsGodotBinary =
    process.platform !== 'win32' &&
    args.godotPath.trim().toLowerCase().endsWith('.exe');

  let wslWindowsHost: string | undefined;
  if (isWsl && isWindowsGodotBinary) {
    try {
      const route = await fs.readFile('/proc/net/route', 'utf8');
      const lines = route.trim().split(/\r?\n/u);
      for (const line of lines.slice(1)) {
        const parts = line.trim().split(/\s+/u);
        const destination = parts[1];
        const gateway = parts[2];
        if (destination !== '00000000') continue;
        if (!gateway || !/^[0-9a-fA-F]{8}$/u.test(gateway)) continue;
        const raw = Number.parseInt(gateway, 16);
        const ip = `${raw & 0xff}.${(raw >> 8) & 0xff}.${(raw >> 16) & 0xff}.${(raw >> 24) & 0xff}`;
        if (ip !== '0.0.0.0') {
          wslWindowsHost = ip;
          break;
        }
      }
    } catch {
      // ignore
    }

    if (!wslWindowsHost) {
      try {
        const resolv = await fs.readFile('/etc/resolv.conf', 'utf8');
        for (const line of resolv.split(/\r?\n/u)) {
          const match = line.match(/^\s*nameserver\s+([0-9a-fA-F:.]+)\s*$/u);
          if (match) {
            wslWindowsHost = match[1];
            break;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  const useWslWindowsHost =
    Boolean(wslWindowsHost) && isWsl && isWindowsGodotBinary;
  const listenHost = useWslWindowsHost ? '0.0.0.0' : '127.0.0.1';
  const connectHost = useWslWindowsHost
    ? (wslWindowsHost as string)
    : '127.0.0.1';
  const launchPort = await getFreeTcpPort('127.0.0.1');

  const resolvedGodotPath = normalizeGodotPathForHost(args.godotPath);
  const editorArgs = normalizeGodotArgsForHost(resolvedGodotPath, [
    '--headless',
    '-e',
    '--path',
    absProjectPath,
  ]);

  const launchEnv = {
    ...process.env,
    GODOT_MCP_HOST: listenHost,
    GODOT_MCP_PORT: String(launchPort),
    GODOT_MCP_TOKEN: token,
  };

  const getNodeErrorCode = (error: unknown): string | undefined => {
    if (!error || typeof error !== 'object') return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  };

  // When launching a Windows Godot binary from WSL, environment variables may
  // not reliably propagate into the editor process. Use project files as the
  // source of truth for host/port during this auto-launch, then restore them.
  let originalHostFile: string | null = null;
  try {
    originalHostFile = await fs.readFile(hostFilePath, 'utf8');
  } catch (error) {
    const code = getNodeErrorCode(error);
    if (code !== 'ENOENT') {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        summary: 'Editor bridge auto-launch failed (cannot read host file)',
        error: snippet(message, 1200),
        details: { hostFilePath },
      };
    }
    originalHostFile = null;
  }

  let originalPortFile: string | null = null;
  try {
    originalPortFile = await fs.readFile(portFilePath, 'utf8');
  } catch (error) {
    const code = getNodeErrorCode(error);
    if (code !== 'ENOENT') {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        summary: 'Editor bridge auto-launch failed (cannot read port file)',
        error: snippet(message, 1200),
        details: { portFilePath },
      };
    }
    originalPortFile = null;
  }

  let wroteOverrides = false;
  try {
    await fs.writeFile(hostFilePath, `${listenHost}\n`, 'utf8');
    await fs.writeFile(portFilePath, `${launchPort}\n`, 'utf8');
    wroteOverrides = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      summary:
        'Editor bridge auto-launch failed (cannot write host/port files)',
      error: snippet(message, 1200),
      details: { hostFilePath, portFilePath },
    };
  }

  let stdout = '';
  let stderr = '';
  const limitLog = (value: string, chunk: string, limit = 20_000) => {
    const next = value + chunk;
    return next.length > limit ? next.slice(-limit) : next;
  };

  const child = spawn(resolvedGodotPath, editorArgs, {
    cwd: absProjectPath,
    env: launchEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout?.on('data', (d) => {
    stdout = limitLog(stdout, String(d));
  });
  child.stderr?.on('data', (d) => {
    stderr = limitLog(stderr, String(d));
  });

  let spawnError: Error | undefined;
  child.once('error', (err) => {
    spawnError = err;
  });

  let exitInfo:
    | { code: number | null; signal: NodeJS.Signals | null }
    | undefined;
  const exitPromise = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal };
      resolve(exitInfo);
    });
  });

  const killChild = async (): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }> => {
    if (spawnError) return { code: null, signal: null };
    if (child.exitCode !== null || child.signalCode !== null)
      return await exitPromise;
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }

    const graceful = await Promise.race([
      exitPromise,
      wait(5000).then(() => null),
    ]);
    if (graceful) return graceful;

    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }

    return await Promise.race([exitPromise, wait(3000).then(() => null)]).then(
      (v) => v ?? { code: null, signal: null },
    );
  };

  const timeoutMs = 25_000;
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        return {
          ok: false,
          summary: 'Editor bridge auto-launch failed (spawn error)',
          error: snippet(spawnError.message, 1200),
          details: {
            godotPath: args.godotPath,
            resolvedGodotPath,
            args: editorArgs,
          },
        };
      }

      if (exitInfo) {
        return {
          ok: false,
          summary: 'Editor bridge auto-launch failed (Godot exited early)',
          details: {
            exitCode: exitInfo.code,
            exitSignal: exitInfo.signal,
            resolvedGodotPath,
            args: editorArgs,
            stdout: snippet(stdout, 4000),
            stderr: snippet(stderr, 4000),
          },
        };
      }

      const attempt = await verifyConnectedHealth(
        connectHost,
        launchPort,
        'auto-launched',
        { connectMs: 400, healthMs: 1200 },
      );
      if (attempt.ok) {
        return {
          ...attempt,
          details: {
            ...(attempt.details ?? {}),
            lockFilePath,
            resolvedGodotPath,
            args: editorArgs,
            listenHost,
          },
        };
      }
      lastError = attempt.error ? String(attempt.error) : attempt.summary;

      await wait(250);
    }

    return {
      ok: false,
      summary: 'Editor bridge auto-launch timed out',
      error: snippet(lastError || 'Timeout waiting for bridge', 1200),
      details: {
        timeoutMs,
        lockFilePath,
        host: connectHost,
        listenHost,
        port: launchPort,
        tokenSource,
        resolvedGodotPath,
        args: editorArgs,
        stdout: snippet(stdout, 4000),
        stderr: snippet(stderr, 4000),
        suggestions: [
          'Ensure Godot can start the editor for this project in headless mode.',
          'Check for plugin load errors in the logs above.',
        ],
      },
    };
  } finally {
    await killChild();

    if (wroteOverrides) {
      try {
        if (originalHostFile === null) {
          await fs.rm(hostFilePath, { force: true });
        } else {
          await fs.writeFile(hostFilePath, originalHostFile, 'utf8');
        }
      } catch {
        // ignore best-effort restore
      }

      try {
        if (originalPortFile === null) {
          await fs.rm(portFilePath, { force: true });
        } else {
          await fs.writeFile(portFilePath, originalPortFile, 'utf8');
        }
      } catch {
        // ignore best-effort restore
      }
    }

    if (shouldCleanLockFile) {
      try {
        await fs.rm(lockFilePath, { force: true });
      } catch {
        // ignore
      }
    }
  }
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const suggestions: string[] = [];
  const readOnly = options.readOnly === true;

  const godot = await resolveGodotDetails(options);
  suggestions.push(...godot.suggestions);

  const checks: DoctorChecksDetails = {};

  let projectDetails: DoctorProjectDetails | undefined;
  if (options.projectPath) {
    const projectSetup = await runProjectSetupForEditorBridge(
      options.projectPath,
      { readOnly },
    );
    checks.projectSetup = projectSetup;
    if (!projectSetup.ok && !projectSetup.skipped) {
      suggestions.push('Project setup for editor bridge failed.');
    }
    if (projectSetup.skipped && readOnly) {
      suggestions.push(
        'Read-only mode enabled: project setup changes were not applied.',
      );
    }

    const project = await resolveProjectDetails(options.projectPath);
    projectDetails = project.details;
    suggestions.push(...project.suggestions);
  }

  const toolsDoc = await runToolsDocDriftCheck();
  checks.toolsDoc = toolsDoc;
  if (!toolsDoc.ok && !toolsDoc.skipped) {
    suggestions.push(
      'docs/TOOLS.md appears out of date (run `npm run docs:tools`).',
    );
  }

  const { mcpServer, headlessOps } = await runMcpServerAndHeadlessChecks({
    godotPath: godot.details.ok ? godot.details.path : null,
  });
  checks.mcpServer = mcpServer;
  checks.headlessOps = headlessOps;

  if (!mcpServer.ok) {
    suggestions.push('MCP server self-test failed (tools/list).');
  }
  if (!headlessOps.ok && !headlessOps.skipped) {
    suggestions.push(
      'Headless ops smoke test failed (file/scene/resource creation).',
    );
  }

  const editorBridge = await runEditorBridgeCheck({
    projectPath: options.projectPath,
    godotPath: godot.details.ok ? godot.details.path : null,
    readOnly,
  });
  checks.editorBridge = editorBridge;
  if (!editorBridge.ok && !editorBridge.skipped) {
    suggestions.push('Editor bridge check failed (connect/health).');
  }
  if (editorBridge.skipped && readOnly) {
    suggestions.push(
      'Read-only mode enabled: editor bridge auto-launch may be skipped.',
    );
  }

  const ok =
    Boolean(godot.details.ok) &&
    (projectDetails?.ok ?? true) &&
    Boolean(checks.mcpServer?.ok) &&
    Boolean(checks.headlessOps?.ok) &&
    (!options.projectPath ||
      (Boolean(checks.projectSetup?.ok) && Boolean(checks.editorBridge?.ok)));
  const summary = ok
    ? 'DOCTOR OK: environment looks good.'
    : 'DOCTOR FAIL: one or more checks failed.';

  return {
    ok,
    summary,
    details: { godot: godot.details, project: projectDetails, checks },
    suggestions: Array.from(new Set(suggestions)).filter(Boolean),
  };
}

export function formatDoctorReport(result: DoctorResult): string {
  const lines: string[] = [];
  lines.push(result.summary);

  const godot = result.details.godot;
  lines.push(`Strict path validation: ${godot.strictPathValidation}`);
  if (godot.ok) {
    lines.push(`Godot: OK (${godot.origin}) -> ${godot.path}`);
  } else {
    lines.push(`Godot: FAIL -> ${godot.error ?? 'not found'}`);
    if (godot.attemptedCandidates && godot.attemptedCandidates.length > 0) {
      const tried = godot.attemptedCandidates
        .slice(0, 6)
        .map((a) => `${a.origin}=${a.candidate}`)
        .join(', ');
      lines.push(
        `Godot tried: ${tried}${godot.attemptedCandidates.length > 6 ? ', …' : ''}`,
      );
    }
  }

  const project = result.details.project;
  if (!project) {
    lines.push('Project: SKIPPED (pass --project <path> to enable checks)');
  } else if (project.ok) {
    lines.push(`Project: OK -> ${project.path}`);
    lines.push(`- project.godot: OK (${project.projectGodotPath})`);
    lines.push(
      `- addons/godot_mcp_bridge: ${project.hasBridgeAddon ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- editor plugin enabled (godot_mcp_bridge): ${project.hasBridgePluginEnabled ? 'YES' : 'NO (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_token: ${project.hasTokenFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_port: ${project.hasPortFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_host: ${project.hasHostFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
  } else {
    lines.push(`Project: FAIL -> ${project.error ?? 'invalid project'}`);
    lines.push(
      `- project.godot: ${project.hasProjectGodot ? 'OK' : 'MISSING'} (${project.projectGodotPath})`,
    );
    lines.push(
      `- addons/godot_mcp_bridge: ${project.hasBridgeAddon ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- editor plugin enabled (godot_mcp_bridge): ${project.hasBridgePluginEnabled ? 'YES' : 'NO (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_token: ${project.hasTokenFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_port: ${project.hasPortFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_host: ${project.hasHostFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
  }

  const checks = result.details.checks;
  if (checks) {
    lines.push('');
    lines.push('Checks:');

    const fmt = (label: string, r: DoctorCheckResult | undefined) => {
      if (!r) return;
      const status = r.skipped ? 'SKIPPED' : r.ok ? 'OK' : 'FAIL';
      const suffix = r.ok ? '' : r.error ? ` -> ${r.error}` : '';
      lines.push(`- ${label}: ${status} (${r.summary})${suffix}`);
    };

    fmt('MCP server', checks.mcpServer);
    fmt('Project setup', checks.projectSetup);
    fmt('Tools doc drift', checks.toolsDoc);
    fmt('Headless ops smoke', checks.headlessOps);
    fmt('Editor bridge', checks.editorBridge);
  }

  if (result.suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const s of result.suggestions) lines.push(`- ${s}`);
  }

  return lines.join('\n');
}
