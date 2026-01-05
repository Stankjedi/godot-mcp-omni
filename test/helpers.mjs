import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ENTRY = path.join(__dirname, '..', 'build', 'index.js');

export function isWindowsExePath(p) {
  return typeof p === 'string' && p.toLowerCase().endsWith('.exe');
}

export function mkdtemp(prefix) {
  const godotPath = process.env.GODOT_PATH ?? '';
  const needsWslWinPathTranslation =
    process.platform !== 'win32' && isWindowsExePath(godotPath);
  const base = needsWslWinPathTranslation
    ? path.join(process.cwd(), '.tmp')
    : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

export function resolveResPath(projectPath, resPath) {
  if (typeof resPath !== 'string') return null;
  if (!resPath.startsWith('res://')) return null;
  const rel = resPath.replace(/^res:\/\//u, '');
  return path.join(projectPath, ...rel.split('/'));
}

export function writeMinimalProject(
  projectPath,
  name = 'TestProject',
  mainScene,
) {
  const projectGodot = [
    '; Engine configuration file.',
    "; It's best edited using the editor, not directly.",
    'config_version=5',
    '',
    '[application]',
    `config/name="${name}"`,
    ...(mainScene ? [`run/main_scene="${mainScene}"`] : []),
    '',
  ].join('\n');

  fs.writeFileSync(
    path.join(projectPath, 'project.godot'),
    projectGodot,
    'utf8',
  );
}

export function startServer(env = {}, spawnOptions = {}) {
  const spawnEnv = spawnOptions.env ?? {};
  const mergedEnv = {
    ...process.env,
    ...spawnEnv,
    ...env,
  };

  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const safeKeys = ['ALLOW_DANGEROUS_OPS', 'ALLOW_EXTERNAL_TOOLS'];

  for (const key of safeKeys) {
    if (!hasOwn(env, key) && !hasOwn(spawnEnv, key)) {
      mergedEnv[key] = 'false';
    }
  }

  return spawn(process.execPath, [SERVER_ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...spawnOptions,
    env: mergedEnv,
  });
}

function snippet(value) {
  try {
    const text = JSON.stringify(value);
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return String(value);
  }
}

export async function waitForServerReady(
  client,
  { timeoutMs = 10000, intervalMs = 50 } = {},
) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
      const resp = await client.send(
        'tools/list',
        {},
        Math.min(1000, remainingMs),
      );
      if ('error' in resp) {
        throw new Error(`tools/list error: ${snippet(resp.error)}`);
      }
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Timed out waiting for server ready (${timeoutMs}ms): ${message}`,
  );
}

export async function waitForServerStartup(ms = 300) {
  await new Promise((r) => setTimeout(r, ms));
}
