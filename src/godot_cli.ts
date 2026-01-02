import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { dirname, join, normalize } from 'path';
import { promisify } from 'util';

import {
  shouldTranslateWslPathsForWindowsExe,
  windowsDrivePathToWslPath,
  wslPathToWindowsDrivePath,
} from './platform/path_translation.js';

const execFileAsync = promisify(execFile);

export interface GodotCliOptions {
  godotPath?: string;
  strictPathValidation?: boolean;
  debug?: (message: string) => void;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getExitCodeFromExecError(error: unknown): number {
  if (!isRecord(error)) return 1;
  const code = error.code;
  return typeof code === 'number' ? code : 1;
}

function translateGodotArgValue(value: string): string {
  if (!value) return value;
  if (value.startsWith('res://') || value.startsWith('user://')) return value;
  return wslPathToWindowsDrivePath(value) ?? value;
}

export function normalizeGodotPathForHost(godotPath: string): string {
  return normalizeGodotPathForHostForPlatform(process.platform, godotPath);
}

export function normalizeGodotPathForHostForPlatform(
  platform: NodeJS.Platform,
  godotPath: string,
): string {
  const trimmed = godotPath.trim();
  if (!trimmed || trimmed === 'godot') return trimmed;
  if (platform === 'win32') return trimmed;

  return windowsDrivePathToWslPath(trimmed) ?? trimmed;
}

export function normalizeGodotArgsForHost(
  godotPath: string,
  args: string[],
): string[] {
  return normalizeGodotArgsForHostForPlatform(
    process.platform,
    godotPath,
    args,
  );
}

export function normalizeGodotArgsForHostForPlatform(
  platform: NodeJS.Platform,
  godotPath: string,
  args: string[],
): string[] {
  if (!shouldTranslateWslPathsForWindowsExe(platform, godotPath)) return args;

  const out = [...args];
  for (let i = 0; i < out.length; i += 1) {
    const flag = out[i];
    if ((flag === '--path' || flag === '--script') && i + 1 < out.length) {
      out[i + 1] = translateGodotArgValue(out[i + 1]);
      i += 1;
    }
  }

  return out;
}

export interface GodotPathDetectionAttempt {
  origin: string;
  candidate: string;
  normalized: string;
  valid: boolean;
}

export class GodotPathDetectionError extends Error {
  attemptedCandidates: GodotPathDetectionAttempt[];

  constructor(
    message: string,
    attemptedCandidates: GodotPathDetectionAttempt[],
  ) {
    super(message);
    this.name = 'GodotPathDetectionError';
    this.attemptedCandidates = attemptedCandidates;
  }
}

export function quoteArg(arg: string): string {
  if (!arg) return '""';
  if (/[\s"]/u.test(arg)) {
    return `"${arg.replaceAll('"', '\\"')}"`;
  }
  return arg;
}

export function formatCommand(exe: string, args: string[]): string {
  return [quoteArg(exe), ...args.map(quoteArg)].join(' ');
}

export function isValidGodotPathSync(
  path: string,
  debug?: (m: string) => void,
): boolean {
  try {
    const resolved = normalizeGodotPathForHost(path);
    debug?.(`Quick-validating Godot path: ${path} (resolved: ${resolved})`);
    return resolved === 'godot' || existsSync(resolved);
  } catch (error) {
    debug?.(`Invalid Godot path: ${path}, error: ${String(error)}`);
    return false;
  }
}

export async function isValidGodotPath(
  path: string,
  cache: Map<string, boolean>,
  debug?: (m: string) => void,
): Promise<boolean> {
  if (cache.has(path)) return cache.get(path) ?? false;

  try {
    const resolved = normalizeGodotPathForHost(path);
    debug?.(`Validating Godot path: ${path} (resolved: ${resolved})`);

    if (resolved !== 'godot' && !existsSync(resolved)) {
      debug?.(`Path does not exist: ${resolved}`);
      cache.set(path, false);
      return false;
    }

    await execFileAsync(resolved, ['--version'], { windowsHide: true });
    cache.set(path, true);
    return true;
  } catch (error) {
    debug?.(`Invalid Godot path: ${path}, error: ${String(error)}`);
    cache.set(path, false);
    return false;
  }
}

function discoverExecutables(
  rootDir: string,
  fileNamePattern: RegExp,
  maxDepth: number,
): string[] {
  const found: string[] = [];

  const visit = (dir: string, depth: number): void => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile()) {
        if (fileNamePattern.test(entry.name)) found.push(fullPath);
        continue;
      }
      if (entry.isDirectory() && depth < maxDepth) visit(fullPath, depth + 1);
    }
  };

  visit(rootDir, 0);
  return found;
}

export type BundledGodotExecutable = { origin: string; path: string };

function isWslEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

export function discoverBundledGodotExecutables(
  platform: NodeJS.Platform,
  cwd: string,
  opts: { isWsl?: boolean } = {},
): BundledGodotExecutable[] {
  if (!cwd) return [];

  const roots: { origin: string; dir: string }[] = [
    { origin: 'auto:bundle:cwd', dir: cwd },
  ];
  const parent = dirname(cwd);
  if (parent && parent !== cwd) {
    roots.push({ origin: 'auto:bundle:parent', dir: parent });
  }

  const windowsExePatterns = [
    /^Godot_v.*_win(64|32)(_console)?\.exe$/iu,
    /^Godot(_console)?\.exe$/iu,
  ];
  const linuxBinPatterns = [
    /^Godot_v.*_linux\.(x86_64|x86_32|arm64|arm32)(_console)?$/iu,
    /^Godot(\.x86_64|\.x86_32|\.arm64|\.arm32)?$/iu,
  ];

  const isWsl = opts.isWsl ?? isWslEnv(process.env);
  const patterns =
    platform === 'win32'
      ? windowsExePatterns
      : platform === 'linux'
        ? isWsl
          ? [...linuxBinPatterns, ...windowsExePatterns]
          : linuxBinPatterns
        : [];
  if (patterns.length === 0) return [];

  const out: BundledGodotExecutable[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith('Godot_v') && !entry.name.startsWith('Godot_'))
        continue;

      const bundleDir = join(root.dir, entry.name);
      for (const pattern of patterns) {
        for (const p of discoverExecutables(bundleDir, pattern, 2)) {
          if (seen.has(p)) continue;
          seen.add(p);
          out.push({ origin: root.origin, path: p });
        }
      }
    }
  }

  return out;
}

export async function detectGodotPath(
  options: GodotCliOptions = {},
): Promise<string> {
  const debug = options.debug;
  const strict = options.strictPathValidation === true;
  const osPlatform = process.platform;
  const cache = new Map<string, boolean>();
  const attempted: GodotPathDetectionAttempt[] = [];

  const tryCandidate = async (
    origin: string,
    candidate: string,
  ): Promise<string | null> => {
    const normalizedCandidate = normalize(candidate);
    const valid = await isValidGodotPath(normalizedCandidate, cache, debug);
    attempted.push({
      origin,
      candidate,
      normalized: normalizedCandidate,
      valid,
    });
    return valid ? normalizedCandidate : null;
  };

  if (options.godotPath) {
    const found = await tryCandidate('config', options.godotPath);
    if (found) return found;
  }

  if (process.env.GODOT_PATH !== undefined) {
    const raw = process.env.GODOT_PATH.trim();
    if (!raw) {
      debug?.('GODOT_PATH is set but empty; skipping auto-detection.');
      if (osPlatform === 'win32')
        return normalize('C:\\__godot_disabled__\\Godot.exe');
      if (osPlatform === 'darwin')
        return normalize('/__godot_disabled__/Godot.app/Contents/MacOS/Godot');
      return normalize('/__godot_disabled__/godot');
    }

    const found = await tryCandidate('env', raw);
    if (found) return found;
  }

  debug?.(`Auto-detecting Godot path for platform: ${osPlatform}`);

  const seen = new Set<string>();
  const candidates: { origin: string; normalized: string }[] = [];
  const pushCandidate = (origin: string, candidate: string): void => {
    if (!candidate) return;
    const normalizedCandidate = normalize(candidate);
    if (!normalizedCandidate) return;
    if (seen.has(normalizedCandidate)) return;
    seen.add(normalizedCandidate);
    candidates.push({ origin, normalized: normalizedCandidate });
  };

  pushCandidate('auto:path', 'godot');

  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const cwd = process.cwd();

  if (cwd) {
    if (osPlatform === 'win32') {
      const exePatterns = [
        /^Godot_v.*_win(64|32)(_console)?\.exe$/iu,
        /^Godot(_console)?\.exe$/iu,
      ];
      for (const pattern of exePatterns) {
        for (const p of discoverExecutables(
          join(cwd, '.tmp', 'godot'),
          pattern,
          1,
        )) {
          pushCandidate('auto:cwd:.tmp', p);
        }
        for (const p of discoverExecutables(
          join(cwd, '.tools', 'godot'),
          pattern,
          2,
        )) {
          pushCandidate('auto:cwd:.tools', p);
        }
      }
    } else if (osPlatform === 'linux') {
      const binPatterns = [
        /^Godot_v.*_linux\.(x86_64|x86_32|arm64|arm32)(_console)?$/iu,
        /^Godot(\.x86_64|\.x86_32|\.arm64|\.arm32)?$/iu,
      ];
      for (const pattern of binPatterns) {
        for (const p of discoverExecutables(
          join(cwd, '.tmp', 'godot'),
          pattern,
          1,
        )) {
          pushCandidate('auto:cwd:.tmp', p);
        }
        for (const p of discoverExecutables(
          join(cwd, '.tools', 'godot'),
          pattern,
          2,
        )) {
          pushCandidate('auto:cwd:.tools', p);
        }
      }
    }

    for (const b of discoverBundledGodotExecutables(osPlatform, cwd)) {
      pushCandidate(b.origin, b.path);
    }
  }

  if (osPlatform === 'darwin') {
    pushCandidate(
      'auto:platform',
      '/Applications/Godot.app/Contents/MacOS/Godot',
    );
    pushCandidate(
      'auto:platform',
      '/Applications/Godot_4.app/Contents/MacOS/Godot',
    );
    if (home) {
      pushCandidate(
        'auto:platform',
        `${home}/Applications/Godot.app/Contents/MacOS/Godot`,
      );
      pushCandidate(
        'auto:platform',
        `${home}/Applications/Godot_4.app/Contents/MacOS/Godot`,
      );
      pushCandidate(
        'auto:platform',
        `${home}/Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot`,
      );
      pushCandidate(
        'auto:portable',
        `${home}/Downloads/Godot.app/Contents/MacOS/Godot`,
      );
    }
  } else if (osPlatform === 'win32') {
    pushCandidate('auto:platform', 'C:\\Program Files\\Godot\\Godot.exe');
    pushCandidate('auto:platform', 'C:\\Program Files (x86)\\Godot\\Godot.exe');
    pushCandidate('auto:platform', 'C:\\Program Files\\Godot_4\\Godot.exe');
    pushCandidate(
      'auto:platform',
      'C:\\Program Files (x86)\\Godot_4\\Godot.exe',
    );

    const userProfile = process.env.USERPROFILE ?? '';
    const localAppData = process.env.LOCALAPPDATA ?? '';
    if (userProfile) {
      pushCandidate('auto:user', `${userProfile}\\Godot\\Godot.exe`);
      pushCandidate(
        'auto:user',
        `${userProfile}\\AppData\\Local\\Programs\\Godot\\Godot.exe`,
      );
      pushCandidate(
        'auto:user',
        `${userProfile}\\AppData\\Local\\Programs\\Godot Engine\\Godot.exe`,
      );
      pushCandidate(
        'auto:user',
        `${userProfile}\\AppData\\Local\\Godot\\Godot.exe`,
      );
      pushCandidate(
        'auto:user',
        `${userProfile}\\AppData\\Local\\Godot Engine\\Godot.exe`,
      );

      const portableExePatterns = [
        /^Godot_v.*_win(64|32)(_console)?\.exe$/iu,
        /^Godot.*(_console)?\.exe$/iu,
      ];
      const portableDirs = [
        join(userProfile, 'Downloads'),
        join(userProfile, 'Desktop'),
        join(userProfile, 'Documents'),
        join(userProfile, 'Godot'),
      ];
      for (const dir of portableDirs) {
        for (const pattern of portableExePatterns) {
          for (const p of discoverExecutables(dir, pattern, 1)) {
            pushCandidate('auto:portable', p);
          }
        }
      }
    }
    if (localAppData) {
      pushCandidate('auto:user', `${localAppData}\\Programs\\Godot\\Godot.exe`);
      pushCandidate(
        'auto:user',
        `${localAppData}\\Programs\\Godot Engine\\Godot.exe`,
      );
      pushCandidate('auto:user', `${localAppData}\\Godot\\Godot.exe`);
      pushCandidate('auto:user', `${localAppData}\\Godot Engine\\Godot.exe`);
    }
  } else if (osPlatform === 'linux') {
    pushCandidate('auto:platform', '/usr/bin/godot');
    pushCandidate('auto:platform', '/usr/local/bin/godot');
    pushCandidate('auto:platform', '/snap/bin/godot');
    if (home) {
      pushCandidate('auto:platform', `${home}/.local/bin/godot`);

      const portableBinPatterns = [
        /^Godot_v.*_linux\.(x86_64|x86_32|arm64|arm32)(_console)?$/iu,
        /^Godot(\.x86_64|\.x86_32|\.arm64|\.arm32)?$/iu,
      ];
      const portableDirs = [
        join(home, 'Downloads'),
        join(home, 'Desktop'),
        join(home, 'godot'),
        join(home, '.local', 'share', 'godot'),
      ];
      for (const dir of portableDirs) {
        for (const pattern of portableBinPatterns) {
          for (const p of discoverExecutables(dir, pattern, 1)) {
            pushCandidate('auto:portable', p);
          }
        }
      }
    }
  }

  for (const c of candidates) {
    const found = await tryCandidate(c.origin, c.normalized);
    if (found) return found;
  }

  const message =
    `Could not find a valid Godot executable for ${osPlatform}. ` +
    `Set the GODOT_PATH environment variable (or pass a valid godotPath option) to continue.`;

  if (strict) throw new GodotPathDetectionError(message, attempted);

  debug?.(message);

  if (osPlatform === 'win32')
    return normalize('C:\\Program Files\\Godot\\Godot.exe');
  if (osPlatform === 'darwin')
    return normalize('/Applications/Godot.app/Contents/MacOS/Godot');
  return normalize('/usr/bin/godot');
}

export async function execGodot(
  godotPath: string,
  args: string[],
): Promise<ExecResult> {
  return await new Promise<ExecResult>((resolve) => {
    const resolvedGodotPath = normalizeGodotPathForHost(godotPath);
    const normalizedArgs = normalizeGodotArgsForHost(resolvedGodotPath, args);
    let settled = false;
    const settle = (value: ExecResult) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const child = execFile(
      resolvedGodotPath,
      normalizedArgs,
      { windowsHide: true },
      (error, stdout, stderr) => {
        const exitCode = error ? getExitCodeFromExecError(error) : 0;
        settle({
          stdout: stdout ?? '',
          stderr: stderr ?? (error ? String(error) : ''),
          exitCode,
        });
      },
    );

    // Some platforms can emit 'error' before callback.
    child.on('error', (err) => {
      settle({ stdout: '', stderr: String(err), exitCode: 1 });
    });
  });
}
