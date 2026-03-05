import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { JsonRpcProcessClient } from '../utils/jsonrpc_process_client.js';

const SPAWN_ENV_ALLOWLIST = [
  // POSIX
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  // Windows
  'Path',
  'SystemRoot',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'ComSpec',
  // Project flags
  'DEBUG',
] as const;

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveServerEntryPath(moduleUrl: string): string {
  const __filename = fileURLToPath(moduleUrl);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', 'index.js');
}

export function buildSpawnEnv(options: {
  parentEnv?: NodeJS.ProcessEnv;
  ciSafe: boolean;
  effectiveGodotPath: string;
}): NodeJS.ProcessEnv {
  const parentEnv = options.parentEnv ?? process.env;
  const env: NodeJS.ProcessEnv = {};

  for (const key of SPAWN_ENV_ALLOWLIST) {
    const value = parentEnv[key];
    if (typeof value === 'string') env[key] = value;
  }

  env.GODOT_PATH = options.ciSafe ? '' : options.effectiveGodotPath;
  env.ALLOW_DANGEROUS_OPS = 'false';
  env.ALLOW_EXTERNAL_TOOLS = 'false';

  return env;
}

export function drainChildStderr(child: ChildProcess): void {
  if (!child.stderr) return;
  child.stderr.on('data', () => {});
}

export async function shutdownChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;

  try {
    child.stdin?.end();
  } catch {
    // Ignore.
  }

  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });

  child.kill();
  await Promise.race([exitPromise, sleep(2000)]);

  if (child.exitCode !== null) return;
  if (process.platform !== 'win32') {
    child.kill('SIGKILL');
    await Promise.race([exitPromise, sleep(2000)]);
  }
}

function snippet(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return String(value);
  }
}

export async function waitForServerReady(
  client: JsonRpcProcessClient,
  { timeoutMs = 10000, intervalMs = 50 } = {},
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

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
    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out waiting for server ready (${timeoutMs}ms): ${formatError(lastError)}`,
  );
}
