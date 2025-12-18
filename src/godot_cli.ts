import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join, normalize } from 'path';
import { promisify } from 'util';

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

export interface GodotPathDetectionAttempt {
  origin: string;
  candidate: string;
  normalized: string;
  valid: boolean;
}

export class GodotPathDetectionError extends Error {
  attemptedCandidates: GodotPathDetectionAttempt[];

  constructor(message: string, attemptedCandidates: GodotPathDetectionAttempt[]) {
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

export function isValidGodotPathSync(path: string, debug?: (m: string) => void): boolean {
  try {
    debug?.(`Quick-validating Godot path: ${path}`);
    return path === 'godot' || existsSync(path);
  } catch (error) {
    debug?.(`Invalid Godot path: ${path}, error: ${String(error)}`);
    return false;
  }
}

export async function isValidGodotPath(
  path: string,
  cache: Map<string, boolean>,
  debug?: (m: string) => void
): Promise<boolean> {
  if (cache.has(path)) return cache.get(path) ?? false;

  try {
    debug?.(`Validating Godot path: ${path}`);

    if (path !== 'godot' && !existsSync(path)) {
      debug?.(`Path does not exist: ${path}`);
      cache.set(path, false);
      return false;
    }

    await execFileAsync(path, ['--version'], { windowsHide: true });
    cache.set(path, true);
    return true;
  } catch (error) {
    debug?.(`Invalid Godot path: ${path}, error: ${String(error)}`);
    cache.set(path, false);
    return false;
  }
}

function discoverExecutables(rootDir: string, fileNamePattern: RegExp, maxDepth: number): string[] {
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

export async function detectGodotPath(options: GodotCliOptions = {}): Promise<string> {
  const debug = options.debug;
  const strict = options.strictPathValidation === true;
  const cache = new Map<string, boolean>();
  const attempted: GodotPathDetectionAttempt[] = [];

  const tryCandidate = async (origin: string, candidate: string): Promise<string | null> => {
    const normalizedCandidate = normalize(candidate);
    const valid = await isValidGodotPath(normalizedCandidate, cache, debug);
    attempted.push({ origin, candidate, normalized: normalizedCandidate, valid });
    return valid ? normalizedCandidate : null;
  };

  if (options.godotPath) {
    const found = await tryCandidate('config', options.godotPath);
    if (found) return found;
  }

  if (process.env.GODOT_PATH) {
    const found = await tryCandidate('env', process.env.GODOT_PATH);
    if (found) return found;
  }

  const osPlatform = process.platform;
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
      const exePattern = /^Godot_v.*_win(64|32)(_console)?\.exe$/iu;
      for (const p of discoverExecutables(join(cwd, '.tmp', 'godot'), exePattern, 1)) {
        pushCandidate('auto:cwd:.tmp', p);
      }
      for (const p of discoverExecutables(join(cwd, '.tools', 'godot'), exePattern, 2)) {
        pushCandidate('auto:cwd:.tools', p);
      }
    } else if (osPlatform === 'linux') {
      const binPattern = /^Godot_v.*_linux\.(x86_64|x86_32|arm64|arm32)$/iu;
      for (const p of discoverExecutables(join(cwd, '.tmp', 'godot'), binPattern, 1)) {
        pushCandidate('auto:cwd:.tmp', p);
      }
      for (const p of discoverExecutables(join(cwd, '.tools', 'godot'), binPattern, 2)) {
        pushCandidate('auto:cwd:.tools', p);
      }
    }
  }

  if (osPlatform === 'darwin') {
    pushCandidate('auto:platform', '/Applications/Godot.app/Contents/MacOS/Godot');
    pushCandidate('auto:platform', '/Applications/Godot_4.app/Contents/MacOS/Godot');
    if (home) {
      pushCandidate('auto:platform', `${home}/Applications/Godot.app/Contents/MacOS/Godot`);
      pushCandidate('auto:platform', `${home}/Applications/Godot_4.app/Contents/MacOS/Godot`);
      pushCandidate(
        'auto:platform',
        `${home}/Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot`
      );
      pushCandidate('auto:portable', `${home}/Downloads/Godot.app/Contents/MacOS/Godot`);
    }
  } else if (osPlatform === 'win32') {
    pushCandidate('auto:platform', 'C:\\Program Files\\Godot\\Godot.exe');
    pushCandidate('auto:platform', 'C:\\Program Files (x86)\\Godot\\Godot.exe');
    pushCandidate('auto:platform', 'C:\\Program Files\\Godot_4\\Godot.exe');
    pushCandidate('auto:platform', 'C:\\Program Files (x86)\\Godot_4\\Godot.exe');

    const userProfile = process.env.USERPROFILE ?? '';
    if (userProfile) {
      pushCandidate('auto:user', `${userProfile}\\Godot\\Godot.exe`);
      pushCandidate('auto:user', `${userProfile}\\AppData\\Local\\Programs\\Godot\\Godot.exe`);
      pushCandidate('auto:user', `${userProfile}\\AppData\\Local\\Godot\\Godot.exe`);

      const portableExePattern = /^Godot_v.*_win(64|32)(_console)?\.exe$/iu;
      const portableDirs = [
        join(userProfile, 'Downloads'),
        join(userProfile, 'Desktop'),
        join(userProfile, 'Documents'),
        join(userProfile, 'Godot'),
      ];
      for (const dir of portableDirs) {
        for (const p of discoverExecutables(dir, portableExePattern, 0)) {
          pushCandidate('auto:portable', p);
        }
      }
    }
  } else if (osPlatform === 'linux') {
    pushCandidate('auto:platform', '/usr/bin/godot');
    pushCandidate('auto:platform', '/usr/local/bin/godot');
    pushCandidate('auto:platform', '/snap/bin/godot');
    if (home) {
      pushCandidate('auto:platform', `${home}/.local/bin/godot`);

      const portableBinPattern = /^Godot_v.*_linux\.(x86_64|x86_32|arm64|arm32)$/iu;
      const portableDirs = [join(home, 'Downloads'), join(home, 'godot')];
      for (const dir of portableDirs) {
        for (const p of discoverExecutables(dir, portableBinPattern, 0)) {
          pushCandidate('auto:portable', p);
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
    `Set the GODOT_PATH environment variable or pass a valid godotPath option.`;

  if (strict) throw new GodotPathDetectionError(message, attempted);

  debug?.(message);

  if (osPlatform === 'win32') return normalize('C:\\Program Files\\Godot\\Godot.exe');
  if (osPlatform === 'darwin') return normalize('/Applications/Godot.app/Contents/MacOS/Godot');
  return normalize('/usr/bin/godot');
}

export async function execGodot(godotPath: string, args: string[]): Promise<ExecResult> {
  return await new Promise<ExecResult>((resolve) => {
    let settled = false;
    const settle = (value: ExecResult) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const child = execFile(godotPath, args, { windowsHide: true }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof (error as any)?.code === 'number' ? ((error as any).code as number) : 1) : 0;
      settle({
        stdout: stdout ?? '',
        stderr: stderr ?? (error ? String(error) : ''),
        exitCode,
      });
    });

    // Some platforms can emit 'error' before callback.
    child.on('error', (err) => {
      settle({ stdout: '', stderr: String(err), exitCode: 1 });
    });
  });
}

