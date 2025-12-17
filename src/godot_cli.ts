import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { normalize } from 'path';

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

export async function detectGodotPath(options: GodotCliOptions = {}): Promise<string> {
  const debug = options.debug;
  const strict = options.strictPathValidation === true;
  const cache = new Map<string, boolean>();

  const candidateFromConfig = options.godotPath ? normalize(options.godotPath) : undefined;
  if (candidateFromConfig && isValidGodotPathSync(candidateFromConfig, debug)) {
    if (await isValidGodotPath(candidateFromConfig, cache, debug)) return candidateFromConfig;
  }

  if (process.env.GODOT_PATH) {
    const envPath = normalize(process.env.GODOT_PATH);
    debug?.(`Checking GODOT_PATH environment variable: ${envPath}`);
    if (await isValidGodotPath(envPath, cache, debug)) return envPath;
  }

  const osPlatform = process.platform;
  debug?.(`Auto-detecting Godot path for platform: ${osPlatform}`);

  const possiblePaths: string[] = ['godot'];
  if (osPlatform === 'darwin') {
    possiblePaths.push(
      '/Applications/Godot.app/Contents/MacOS/Godot',
      '/Applications/Godot_4.app/Contents/MacOS/Godot',
      `${process.env.HOME ?? ''}/Applications/Godot.app/Contents/MacOS/Godot`,
      `${process.env.HOME ?? ''}/Applications/Godot_4.app/Contents/MacOS/Godot`,
      `${process.env.HOME ?? ''}/Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot`
    );
  } else if (osPlatform === 'win32') {
    possiblePaths.push(
      'C:\\Program Files\\Godot\\Godot.exe',
      'C:\\Program Files (x86)\\Godot\\Godot.exe',
      'C:\\Program Files\\Godot_4\\Godot.exe',
      'C:\\Program Files (x86)\\Godot_4\\Godot.exe',
      `${process.env.USERPROFILE ?? ''}\\Godot\\Godot.exe`
    );
  } else if (osPlatform === 'linux') {
    possiblePaths.push('/usr/bin/godot', '/usr/local/bin/godot', '/snap/bin/godot', `${process.env.HOME ?? ''}/.local/bin/godot`);
  }

  for (const p of possiblePaths) {
    const normalizedPath = normalize(p);
    if (await isValidGodotPath(normalizedPath, cache, debug)) return normalizedPath;
  }

  const warning =
    `Could not find a valid Godot executable for ${osPlatform}. ` +
    `Set GODOT_PATH or pass a valid godotPath option.`;

  if (strict) throw new Error(warning);

  debug?.(warning);

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
