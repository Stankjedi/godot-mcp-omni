import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  shouldTranslateWslPathsForWindowsExe,
  windowsDrivePathToWslPath as windowsDrivePathToWslPathOrNull,
  wslPathToWindowsDrivePath,
} from '../platform/path_translation.js';

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

type AsepriteExecutableResolution = {
  exe: string | null;
  attemptedCandidates: string[];
};

const asepriteExecutableResolutionCache = new Map<
  string,
  AsepriteExecutableResolution
>();

function externalToolsEnabled(): boolean {
  return process.env.ALLOW_EXTERNAL_TOOLS === 'true';
}

export function windowsDrivePathToWslPath(p: string): string {
  return windowsDrivePathToWslPathOrNull(p) ?? p;
}

function translateAsepriteArgValue(value: string): string {
  if (!value) return value;
  return wslPathToWindowsDrivePath(value) ?? value;
}

export function normalizeAsepriteArgsForHost(
  platform: NodeJS.Platform,
  exe: string,
  args: string[],
): string[] {
  if (!shouldTranslateWslPathsForWindowsExe(platform, exe)) return args;
  return args.map(translateAsepriteArgValue);
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

function isWslEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

export function extractSteamLibraryPathsFromVdfText(vdfText: string): string[] {
  if (!vdfText) return [];

  const found: string[] = [];

  for (const match of vdfText.matchAll(/"path"\s*"([^"]+)"/giu)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    found.push(raw.replaceAll('\\\\', '\\'));
  }

  if (found.length === 0) {
    // Legacy Steam VDF format: numeric keys map to library paths directly.
    for (const match of vdfText.matchAll(/^\s*"\d+"\s*"([^"]+)"\s*$/gmu)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      found.push(raw.replaceAll('\\\\', '\\'));
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of found) {
    const normalized = p.replace(/[\\/]+$/u, '');
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function discoverSteamLibraryFoldersVdfCandidates(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string): void => {
    if (!p) return;
    const trimmed = p.trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  if (process.platform === 'win32') {
    const pf86 = (process.env['ProgramFiles(x86)'] ?? '').trim();
    const pf = (process.env.ProgramFiles ?? '').trim();

    const steamRoots = [
      pf86 ? path.join(pf86, 'Steam') : '',
      pf ? path.join(pf, 'Steam') : '',
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
    ].filter(Boolean);

    for (const steamRoot of steamRoots) {
      push(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'));
    }

    return out;
  }

  if (process.platform === 'linux' && isWslEnv(process.env)) {
    const steamRoots = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
    ];

    for (const steamRoot of steamRoots) {
      push(
        path.join(
          windowsDrivePathToWslPath(steamRoot),
          'steamapps',
          'libraryfolders.vdf',
        ),
      );
    }

    return out;
  }

  const home = (process.env.HOME ?? '').trim();
  if (home) {
    const steamRoots = [
      path.join(home, '.local', 'share', 'Steam'),
      path.join(home, '.steam', 'steam'),
      path.join(
        home,
        '.var',
        'app',
        'com.valvesoftware.Steam',
        '.local',
        'share',
        'Steam',
      ),
    ];
    for (const steamRoot of steamRoots) {
      push(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'));
    }
  }

  return out;
}

function discoverSteamAsepriteCandidates(): string[] {
  const candidates: string[] = [];

  for (const vdfPathCandidate of discoverSteamLibraryFoldersVdfCandidates()) {
    const st = tryStat(vdfPathCandidate);
    if (!st.exists || !st.isFile) continue;

    let raw: string;
    try {
      raw = fs.readFileSync(vdfPathCandidate, 'utf8');
    } catch {
      continue;
    }

    const wsl = process.platform === 'linux' && isWslEnv(process.env);
    const libraryPaths = extractSteamLibraryPathsFromVdfText(raw).map((p) =>
      wsl ? windowsDrivePathToWslPath(p) : p,
    );
    const steamappsDir = path.dirname(vdfPathCandidate);
    const steamRoot = path.dirname(steamappsDir);
    const roots = [steamRoot, ...libraryPaths];

    for (const root of roots) {
      const rootTrimmed = root.trim();
      if (!rootTrimmed) continue;

      const commonDir = path.join(
        rootTrimmed,
        'steamapps',
        'common',
        'Aseprite',
      );
      if (process.platform === 'win32') {
        candidates.push(
          path.join(commonDir, 'Aseprite.exe'),
          path.join(commonDir, 'aseprite.exe'),
          commonDir,
        );
      } else if (process.platform === 'linux' && isWslEnv(process.env)) {
        candidates.push(
          path.join(commonDir, 'Aseprite.exe'),
          path.join(commonDir, 'aseprite.exe'),
          commonDir,
        );
      } else {
        candidates.push(
          path.join(commonDir, 'aseprite'),
          path.join(commonDir, 'Aseprite'),
          commonDir,
        );
      }
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const trimmed = c.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
}

function defaultAsepriteCandidates(): string[] {
  const fromSteam = discoverSteamAsepriteCandidates();
  if (fromSteam.length > 0) {
    return [...fromSteam, 'aseprite'];
  }

  // Steam default on Windows and typical WSL mount equivalent.
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite\\Aseprite.exe',
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite\\aseprite.exe',
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite',
      'aseprite',
    ];
  }

  if (process.platform === 'linux' && !isWslEnv(process.env)) {
    return ['aseprite'];
  }

  return [
    '/mnt/c/Program Files (x86)/Steam/steamapps/common/Aseprite/Aseprite.exe',
    '/mnt/c/Program Files (x86)/Steam/steamapps/common/Aseprite/aseprite.exe',
    '/mnt/c/Program Files (x86)/Steam/steamapps/common/Aseprite',
    'aseprite',
  ];
}

function resolveAsepriteExecutable(): AsepriteExecutableResolution {
  const attemptedCandidates: string[] = [];

  const rawEnvValue = (process.env.ASEPRITE_PATH ?? '').trim();
  if (rawEnvValue.length > 0) {
    attemptedCandidates.push(rawEnvValue);
    const envValue =
      process.platform === 'win32'
        ? rawEnvValue
        : windowsDrivePathToWslPath(rawEnvValue);
    if (envValue !== rawEnvValue) attemptedCandidates.push(envValue);

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

function resolveAsepriteExecutableCached(): AsepriteExecutableResolution {
  const asepritePathEnv = (process.env.ASEPRITE_PATH ?? '').trim();
  const key = `${process.platform}|${asepritePathEnv}`;
  const cached = asepriteExecutableResolutionCache.get(key);
  if (cached) return cached;

  const resolved = resolveAsepriteExecutable();
  asepriteExecutableResolutionCache.set(key, resolved);
  return resolved;
}

export function getAsepriteStatus(): {
  externalToolsEnabled: boolean;
  asepritePathEnv: string | null;
  resolvedExecutable: string | null;
  attemptedCandidates: string[];
} {
  const asepritePathEnv = (process.env.ASEPRITE_PATH ?? '').trim();
  const resolved = resolveAsepriteExecutableCached();
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

  const resolved = resolveAsepriteExecutableCached();
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
  const normalizedArgs = normalizeAsepriteArgsForHost(
    process.platform,
    exe,
    args,
  );

  return await new Promise<AsepriteRunResult>((resolve) => {
    const child = spawn(exe, normalizedArgs, {
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
        args: normalizedArgs,
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
        args: normalizedArgs,
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
