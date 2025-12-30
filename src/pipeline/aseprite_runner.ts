import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export type AsepriteRunResult = {
  ok: boolean;
  summary: string;
  command: string;
  args: string[];
  attemptedCandidates?: string[];
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  suggestions?: string[];
  capabilities?: {
    splitLayers?: boolean;
    splitSlices?: boolean;
    splitGrid?: boolean;
    exportTileset?: boolean;
  };
};

function externalToolsEnabled(): boolean {
  return process.env.ALLOW_EXTERNAL_TOOLS === 'true';
}

function tryStat(
  candidate: string,
): { exists: true; isFile: boolean; isDirectory: boolean } | { exists: false } {
  try {
    const st = fs.statSync(candidate);
    return { exists: true, isFile: st.isFile(), isDirectory: st.isDirectory() };
  } catch {
    return { exists: false };
  }
}

function resolveAsepriteExecutableFromPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const stat = tryStat(trimmed);
  if (stat.exists && stat.isFile) return trimmed;

  // If the user provided a directory (common for Steam installs), try common filenames.
  if (stat.exists && stat.isDirectory) {
    const candidates = [
      path.join(trimmed, 'Aseprite.exe'),
      path.join(trimmed, 'aseprite.exe'),
      path.join(trimmed, 'aseprite'),
      path.join(trimmed, 'Aseprite'),
    ];
    for (const c of candidates) {
      const st = tryStat(c);
      if (st.exists && st.isFile) return c;
    }
  }

  return null;
}

function defaultAsepriteCandidates(): string[] {
  // Steam default on Windows and typical WSL mount equivalent.
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite\\Aseprite.exe',
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite\\aseprite.exe',
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite',
      'aseprite',
    ];
  }

  return [
    '/mnt/c/Program Files (x86)/Steam/steamapps/common/Aseprite/Aseprite.exe',
    '/mnt/c/Program Files (x86)/Steam/steamapps/common/Aseprite/aseprite.exe',
    '/mnt/c/Program Files (x86)/Steam/steamapps/common/Aseprite',
    'aseprite',
  ];
}

function resolveAsepriteExecutable(): {
  exe: string | null;
  attemptedCandidates: string[];
} {
  const attemptedCandidates: string[] = [];

  const envValue = (process.env.ASEPRITE_PATH ?? '').trim();
  if (envValue.length > 0) {
    attemptedCandidates.push(envValue);
    const resolvedFromEnv = resolveAsepriteExecutableFromPath(envValue);
    if (resolvedFromEnv) return { exe: resolvedFromEnv, attemptedCandidates };
  }

  for (const candidate of defaultAsepriteCandidates()) {
    attemptedCandidates.push(candidate);
    if (candidate === 'aseprite') {
      // Allow PATH resolution; existence will be validated by spawn.
      return { exe: candidate, attemptedCandidates };
    }

    const resolved = resolveAsepriteExecutableFromPath(candidate);
    if (resolved) return { exe: resolved, attemptedCandidates };
  }

  return { exe: null, attemptedCandidates };
}

export function getAsepriteStatus(): {
  externalToolsEnabled: boolean;
  asepritePathEnv: string | null;
  resolvedExecutable: string | null;
  attemptedCandidates: string[];
} {
  const asepritePathEnv = (process.env.ASEPRITE_PATH ?? '').trim();
  const resolved = resolveAsepriteExecutable();
  return {
    externalToolsEnabled: externalToolsEnabled(),
    asepritePathEnv: asepritePathEnv.length > 0 ? asepritePathEnv : null,
    resolvedExecutable: resolved.exe,
    attemptedCandidates: resolved.attemptedCandidates,
  };
}

export async function detectAsepriteCapabilities(
  opts: { timeoutMs?: number } = {},
): Promise<AsepriteRunResult> {
  return await runAseprite(['--help'], opts);
}

export async function runAseprite(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<AsepriteRunResult> {
  const start = Date.now();

  if (!externalToolsEnabled()) {
    return {
      ok: false,
      summary: 'External tools are disabled (ALLOW_EXTERNAL_TOOLS!=true)',
      command: 'aseprite',
      args,
      exitCode: null,
      durationMs: Date.now() - start,
      stdout: '',
      stderr: '',
      suggestions: [
        'Set ALLOW_EXTERNAL_TOOLS=true to enable running Aseprite.',
        'Set ASEPRITE_PATH to your aseprite executable path.',
      ],
    };
  }

  const resolved = resolveAsepriteExecutable();
  const exe = resolved.exe;
  if (!exe) {
    return {
      ok: false,
      summary: 'Aseprite executable not found (Aseprite runner disabled)',
      command: 'aseprite',
      args,
      attemptedCandidates: resolved.attemptedCandidates,
      exitCode: null,
      durationMs: Date.now() - start,
      stdout: '',
      stderr: '',
      suggestions: [
        'Set ASEPRITE_PATH to your Aseprite install directory or executable path.',
        'Steam default (Windows): C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite',
        'WSL default: /mnt/c/Program Files (x86)/Steam/steamapps/common/Aseprite',
      ],
    };
  }

  const timeoutMs = opts.timeoutMs ?? 120_000;
  const cwd = opts.cwd;

  return await new Promise<AsepriteRunResult>((resolve) => {
    const child = spawn(exe, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(killTimer);
      resolve({
        ok: false,
        summary: `Failed to spawn Aseprite: ${error.message}`,
        command: exe,
        args,
        exitCode: null,
        durationMs: Date.now() - start,
        stdout,
        stderr,
        suggestions: [
          'Verify ASEPRITE_PATH is correct and executable.',
          'Try running the same command manually to confirm it works.',
        ],
      });
    });

    child.on('close', (code) => {
      clearTimeout(killTimer);
      const ok = code === 0;

      const helpText = `${stdout}\n${stderr}`.toLowerCase();
      const capabilities = {
        splitLayers: helpText.includes('--split-layers'),
        splitSlices:
          helpText.includes('--split-slices') ||
          helpText.includes('--split-slice'),
        splitGrid: helpText.includes('--split-grid'),
        exportTileset: helpText.includes('--export-tileset'),
      };

      resolve({
        ok,
        summary: ok ? 'Aseprite command succeeded' : 'Aseprite command failed',
        command: exe,
        args,
        exitCode: code,
        durationMs: Date.now() - start,
        stdout,
        stderr,
        capabilities,
        suggestions: ok
          ? undefined
          : [
              'Check stderr for CLI errors.',
              'Verify your Aseprite version supports the requested flags.',
            ],
      });
    });
  });
}
