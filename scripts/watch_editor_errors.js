#!/usr/bin/env node

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createStepRunner,
  formatError,
  resolveGodotPath,
  spawnMcpServer,
  wait,
} from './mcp_test_harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  return [
    'Watch Godot editor logs via the editor bridge and print error-like lines.',
    '',
    'Usage:',
    '  node scripts/watch_editor_errors.js --project <path> [--godot-path <path>] [--launch] [--interval <ms>] [--open-script]',
    '',
    'Notes:',
    '  - Requires the editor bridge addon running in the Godot editor.',
    '  - Keeps ALLOW_DANGEROUS_OPS=false (safe mode).',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    projectPath: null,
    godotPath: null,
    intervalMs: 750,
    launch: false,
    openScript: false,
  };
  const rest = [...argv];

  while (rest.length > 0) {
    const token = rest.shift();
    if (!token) break;

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--project') {
      args.projectPath = rest.shift() ?? null;
      continue;
    }
    if (token === '--godot-path') {
      args.godotPath = rest.shift() ?? null;
      continue;
    }
    if (token === '--interval') {
      const raw = rest.shift() ?? '';
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --interval: ${raw}`);
      }
      args.intervalMs = n;
      continue;
    }
    if (token === '--launch') {
      args.launch = true;
      continue;
    }
    if (token === '--open-script') {
      args.openScript = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}\n\n${usage()}`);
  }

  return args;
}

function printLines(lines) {
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(usage());
    process.exit(0);
    return;
  }
  if (!parsed.projectPath) {
    console.error('Missing required flag: --project\n');
    console.error(usage());
    process.exit(2);
    return;
  }

  const repoRoot = path.resolve(__dirname, '..');
  const serverEntry = path.join(repoRoot, 'build', 'index.js');

  const godotPath = await resolveGodotPath({
    godotPath: parsed.godotPath ?? undefined,
    strictPathValidation: false,
    exampleCommand:
      'GODOT_PATH="C:\\\\Path\\\\To\\\\Godot_v4.x_win64_console.exe" node scripts/watch_editor_errors.js --project ../my_project --launch',
  });

  const { client, shutdown } = spawnMcpServer({
    serverEntry,
    env: { GODOT_PATH: godotPath, ALLOW_DANGEROUS_OPS: 'false' },
    debugStderr: false,
    allowDangerousOps: false,
  });

  const { runStep } = createStepRunner();

  let running = true;
  process.on('SIGINT', () => {
    running = false;
  });

  try {
    await wait(250);

    if (parsed.launch) {
      await runStep('launch editor (optional)', async () =>
        client.callTool('godot_workspace_manager', {
          action: 'launch',
          projectPath: parsed.projectPath,
        }),
      );
      await wait(800);
    }

    await runStep('connect editor', async () =>
      client.callTool('godot_workspace_manager', {
        action: 'connect',
        projectPath: parsed.projectPath,
      }),
    );

    let cursor = -64 * 1024;

    while (running) {
      const resp = await client.callTool('godot_log_manager', {
        action: 'poll',
        cursor,
        maxBytes: 64 * 1024,
        maxMatches: 200,
        onlyErrors: true,
        openScriptOnError: parsed.openScript,
      });

      if (resp.ok) {
        const lines = Array.isArray(resp.details?.lines)
          ? resp.details.lines
          : [];
        const nextOffset =
          typeof resp.details?.nextOffset === 'number'
            ? resp.details.nextOffset
            : cursor;
        if (lines.length > 0) {
          process.stdout.write('\n--- Godot error-like log lines ---\n');
          printLines(lines);
        }
        cursor = nextOffset ?? cursor;
      }

      await wait(parsed.intervalMs);
    }
  } finally {
    await shutdown();
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
