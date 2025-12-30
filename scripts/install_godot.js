#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function usage() {
  return [
    'Usage:',
    '  node scripts/install_godot.js [--version <ver>] [--platform <platform>]',
    '',
    'Options:',
    '  --version <ver>       Godot release tag (default: 4.5.1-stable)',
    '  --platform <platform> Target platform (default: auto-detected)',
    '  --help, -h            Show this help and exit',
    '',
    'Platforms:',
    '  - linux-x86_64 (supported)',
    '  - windows-x86_64 (supported)',
    '',
    'Notes:',
    '  - Uses curl + unzip when a download/extract is needed.',
    '  - Prints ONLY the resolved executable path to stdout on success.',
    '  - Cache dir: godot-mcp-omni/.cache/godot/<version>/<platform>/',
  ].join('\n');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let version = '4.5.1-stable';
  let platform = undefined;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') return { help: true, version, platform };
    if (a === '--version') {
      const value = args[i + 1];
      if (!value || value.startsWith('-'))
        throw new Error(`Missing value for --version\n\n${usage()}`);
      version = value;
      i += 1;
      continue;
    }
    if (a === '--platform') {
      const value = args[i + 1];
      if (!value || value.startsWith('-'))
        throw new Error(`Missing value for --platform\n\n${usage()}`);
      platform = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${a}\n\n${usage()}`);
  }

  return { help: false, version, platform };
}

function defaultPlatform() {
  if (process.platform === 'win32') return 'windows-x86_64';
  if (process.platform === 'linux') return 'linux-x86_64';
  return undefined;
}

function platformSpec(version, platform) {
  if (platform === 'linux-x86_64') {
    const baseName = `Godot_v${version}_linux.x86_64`;
    return {
      assetName: `${baseName}.zip`,
      exeName: baseName,
      isWindows: false,
    };
  }

  if (platform === 'windows-x86_64') {
    const baseName = `Godot_v${version}_win64.exe`;
    return {
      assetName: `${baseName}.zip`,
      exeName: baseName,
      isWindows: true,
    };
  }

  throw new Error(
    `Unsupported platform: ${platform}\n\nSupported: linux-x86_64, windows-x86_64`,
  );
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args, { cwd } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status === 0) return;

  const stderr = (res.stderr ?? '').trim();
  const stdout = (res.stdout ?? '').trim();
  const details = [stderr, stdout].filter(Boolean).join('\n');
  throw new Error(
    `Command failed: ${cmd} ${args.join(' ')}\n` +
      `Exit code: ${res.status ?? 1}` +
      (details ? `\n\n${details}` : ''),
  );
}

function hasCommand(cmd, args = ['--help']) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  if (res.error && typeof res.error === 'object') {
    const code = res.error.code;
    if (code === 'ENOENT' || code === 'EACCES') return false;
  }
  return true;
}

function extractZip(zipPath, destDir) {
  if (hasCommand('unzip')) {
    run('unzip', ['-o', '-q', zipPath, '-d', destDir]);
    return;
  }

  if (hasCommand('python3', ['-c', 'import sys'])) {
    run('python3', ['-m', 'zipfile', '-e', zipPath, destDir]);
    return;
  }

  if (hasCommand('python', ['-c', 'import sys'])) {
    run('python', ['-m', 'zipfile', '-e', zipPath, destDir]);
    return;
  }

  throw new Error(
    'Zip extraction requires either `unzip`, `python3`, or `python` to be available on PATH.',
  );
}

async function ensureExecutableMode(exePath, isWindows) {
  if (isWindows) return;
  try {
    await fs.chmod(exePath, 0o755);
  } catch {
    // best-effort only (some FS may not support chmod)
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
    return;
  }

  if (parsed.help) {
    console.log(usage());
    process.exit(0);
    return;
  }

  const version = parsed.version;
  const platform = parsed.platform ?? defaultPlatform();
  if (!platform) {
    console.error(
      `Failed to auto-detect platform for ${process.platform}. Use --platform explicitly.\n\n${usage()}`,
    );
    process.exit(1);
    return;
  }

  const spec = platformSpec(version, platform);
  const cacheDir = path.join(repoRoot, '.cache', 'godot', version, platform);
  await fs.mkdir(cacheDir, { recursive: true });

  const exePath = path.join(cacheDir, spec.exeName);
  const zipPath = path.join(cacheDir, spec.assetName);

  if (!(await fileExists(exePath))) {
    const url = `https://github.com/godotengine/godot/releases/download/${version}/${spec.assetName}`;

    if (!(await fileExists(zipPath))) {
      run('curl', ['-fsSL', '-o', zipPath, url]);
    }

    extractZip(zipPath, cacheDir);

    if (!(await fileExists(exePath))) {
      throw new Error(
        `Extraction did not produce expected executable: ${exePath}\n` +
          `Downloaded: ${zipPath}`,
      );
    }

    await ensureExecutableMode(exePath, spec.isWindows);
  }

  const resolved = path.resolve(exePath);
  process.stdout.write(`${resolved}\n`);
}

main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
