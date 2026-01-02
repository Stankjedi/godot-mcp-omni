export function windowsDrivePathToWslPath(p: string): string | null {
  const trimmed = p.trim();
  const match = trimmed.match(/^([a-zA-Z]):[\\/](.*)$/u);
  if (!match) return null;
  const drive = match[1].toLowerCase();
  const rest = match[2].replaceAll('\\', '/');
  return `/mnt/${drive}/${rest}`;
}

export function wslPathToWindowsDrivePath(p: string): string | null {
  const trimmed = p.trim();
  const match = trimmed.match(/^\/mnt\/([a-zA-Z])\/(.*)$/u);
  if (!match) return null;
  const drive = match[1].toUpperCase();
  const rest = match[2].replaceAll('/', '\\');
  return `${drive}:\\${rest}`;
}

export function isWindowsExePath(p: string): boolean {
  return p.trim().toLowerCase().endsWith('.exe');
}

export function shouldTranslateWslPathsForWindowsExe(
  platform: NodeJS.Platform,
  exe: string,
): boolean {
  // WSL (linux) running a Windows .exe expects Windows-style paths in args.
  return platform !== 'win32' && isWindowsExePath(exe);
}
