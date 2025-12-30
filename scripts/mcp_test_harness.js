import process from 'node:process';
import { spawn } from 'node:child_process';

import { detectGodotPath, isValidGodotPath } from '../build/godot_cli.js';
import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';

export function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveGodotPath({
  godotPath,
  strictPathValidation = true,
  skipValidation = false,
  exampleCommand,
} = {}) {
  const explicit = typeof godotPath === 'string' ? godotPath.trim() : '';
  const fromEnv = process.env.GODOT_PATH?.trim() ?? '';

  if (explicit) {
    if (skipValidation) return explicit;
    const cache = new Map();
    const ok = await isValidGodotPath(explicit, cache);
    if (ok) return explicit;
    throw new Error(
      `Godot executable is not valid: ${explicit}\n` +
        (exampleCommand
          ? `Example: ${exampleCommand}`
          : 'Set GODOT_PATH to a working Godot binary.'),
    );
  }

  if (fromEnv) {
    if (skipValidation) return fromEnv;
    const cache = new Map();
    const ok = await isValidGodotPath(fromEnv, cache);
    if (ok) return fromEnv;
    throw new Error(
      `Godot executable is not valid: ${fromEnv}\n` +
        (exampleCommand
          ? `Example: ${exampleCommand}`
          : 'Set GODOT_PATH to a working Godot binary.'),
    );
  }

  try {
    return await detectGodotPath({ strictPathValidation });
  } catch (error) {
    throw new Error(
      `Failed to auto-detect Godot executable.\n` +
        `Reason: ${formatError(error)}\n` +
        (exampleCommand
          ? `Example: ${exampleCommand}`
          : 'Set GODOT_PATH to a working Godot binary.'),
    );
  }
}

export function createStepRunner({
  onStart = (label) => console.log(`RUN: ${label}`),
  onPass = (label) => console.log(`PASS: ${label}`),
  onFail = (label, errorMessage) =>
    console.log(`FAIL: ${label} -> ${errorMessage}`),
} = {}) {
  const results = [];

  const runStep = async (label, fn) => {
    onStart(label);
    try {
      const value = await fn();
      results.push({ label, ok: true });
      onPass(label, value);
      return value;
    } catch (error) {
      const message = formatError(error);
      results.push({ label, ok: false, error: message });
      onFail(label, message);
      return null;
    }
  };

  return { results, runStep };
}

export function spawnMcpServer({
  serverEntry,
  env = {},
  debugStderr = false,
  allowDangerousOps = true,
  cleanup,
  onShutdown,
} = {}) {
  const mergedEnv = { ...process.env, ...env };
  if (allowDangerousOps && mergedEnv.ALLOW_DANGEROUS_OPS !== 'true') {
    mergedEnv.ALLOW_DANGEROUS_OPS = 'true';
  }

  const server = spawn(process.execPath, [serverEntry], {
    env: mergedEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (debugStderr) {
    server.stderr.on('data', (d) => process.stderr.write(d));
  }

  const client = new JsonRpcProcessClient(server);

  const shutdown = async () => {
    client.dispose();
    try {
      server.kill();
    } catch {
      // ignore
    }
    if (typeof cleanup === 'function') {
      try {
        await cleanup();
      } catch {
        // ignore
      }
    }
    if (typeof onShutdown === 'function') {
      try {
        await onShutdown();
      } catch {
        // ignore
      }
    }
  };

  return { server, client, shutdown };
}
