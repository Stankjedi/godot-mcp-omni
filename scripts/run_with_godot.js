#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  return [
    'Usage:',
    '  node scripts/run_with_godot.js <command> [args...]',
    '',
    'Examples:',
    '  node scripts/run_with_godot.js npm test',
    '  node scripts/run_with_godot.js npm run verify:scenarios',
    '',
    'Notes:',
    '  - Installs pinned Godot if needed via scripts/install_godot.js',
    '  - Sets GODOT_PATH for the invoked command',
    '  - First run may download a large archive (cached under .cache/godot/)',
  ].join('\n');
}

function defaultPlatform() {
  if (process.platform === 'win32') return 'windows-x86_64';
  if (process.platform === 'linux') return 'linux-x86_64';
  return undefined;
}

function resolveCommand(cmd) {
  if (process.platform !== 'win32') return cmd;
  if (cmd.toLowerCase() === 'npm') return 'npm.cmd';
  return cmd;
}

function runNodeScript(scriptPath, args) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (res.status === 0) return res.stdout.trim();

  const stderr = (res.stderr ?? '').trim();
  const stdout = (res.stdout ?? '').trim();
  const details = [stderr, stdout].filter(Boolean).join('\n');
  const message =
    `Failed to run: node ${scriptPath} ${args.join(' ')}` +
    `\nExit code: ${res.status ?? 1}` +
    (details ? `\n\n${details}` : '');

  console.error(message);
  process.exit(res.status ?? 1);
}

function main() {
  const [, , rawCmd, ...cmdArgs] = process.argv;
  if (!rawCmd) {
    console.error(usage());
    process.exit(1);
    return;
  }

  const platform = defaultPlatform();
  const installScriptPath = path.join(__dirname, 'install_godot.js');

  const installArgs = ['--version', '4.5.1-stable'];
  if (platform) installArgs.push('--platform', platform);

  const godotPath = runNodeScript(installScriptPath, installArgs);
  if (!godotPath) {
    console.error('install_godot.js returned an empty path.');
    process.exit(1);
    return;
  }

  const cmd = resolveCommand(rawCmd);
  const res = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    env: { ...process.env, GODOT_PATH: godotPath },
  });

  process.exit(res.status ?? 1);
}

main();
