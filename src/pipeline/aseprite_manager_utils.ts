import fs from 'fs';
import path from 'path';

function normalizeForComparison(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function isInsideRoot(rootAbs: string, candidateAbs: string): boolean {
  const rel = path.relative(rootAbs, candidateAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const rootCmp = normalizeForComparison(rootAbs);
  const candCmp = normalizeForComparison(candidateAbs);
  return candCmp === rootCmp || candCmp.startsWith(`${rootCmp}${path.sep}`);
}

function realpathSafe(p: string): string {
  // Prefer native realpath to preserve Windows drive casing when available.
  const native = (
    fs.realpathSync as unknown as { native?: (p: string) => string }
  ).native;
  return native ? native(p) : fs.realpathSync(p);
}

function findExistingAncestor(absPath: string): {
  existingAbs: string;
  missingParts: string[];
} {
  const missingParts: string[] = [];
  let current = absPath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missingParts.unshift(path.basename(current));
    current = parent;
  }
  return { existingAbs: current, missingParts };
}

export function ensureAPrefix(baseName: string): string {
  const trimmed = baseName.trim();
  if (!trimmed) return 'A_';
  return trimmed.startsWith('A_') ? trimmed : `A_${trimmed}`;
}

export function sanitizeFileComponent(
  input: string,
  opts: { maxLen?: number } = {},
): string {
  const maxLen = opts.maxLen ?? 120;
  let s = input.normalize('NFKC');

  s = s.replace(/[\/\\:*?"<>|]/gu, '_');
  s = s.replace(/\s+/gu, ' ').trim();
  s = s.replace(/[. ]+$/gu, '');

  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  if (!s) return 'unnamed';
  return s;
}

export function numberToFilenameToken(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const raw = String(value);
  return raw.replaceAll('.', 'p');
}

export function absPathToResPath(
  projectRootAbs: string,
  fileAbs: string,
): string | null {
  const rel = path.relative(projectRootAbs, fileAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const normalized = rel.split(path.sep).join('/');
  return `res://${normalized}`;
}

export function resolvePathLikeInsideProject(
  projectPath: string,
  userPath: string,
  opts: { allowMissing?: boolean } = {},
): { projectRootAbs: string; absPath: string; resPath: string } {
  if (!projectPath) throw new Error('projectPath is required');
  if (!userPath) throw new Error('path is required');
  if (userPath.startsWith('user://')) {
    throw new Error(`Disallowed path scheme (user://): ${userPath}`);
  }

  const projectRootResolved = path.resolve(projectPath);
  const projectRootReal = realpathSafe(projectRootResolved);

  let candidate = userPath;
  if (candidate.startsWith('res://'))
    candidate = candidate.slice('res://'.length);

  const candidateResolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(projectRootResolved, candidate);

  const { existingAbs, missingParts } = opts.allowMissing
    ? findExistingAncestor(candidateResolved)
    : { existingAbs: candidateResolved, missingParts: [] };

  const existingReal = realpathSafe(existingAbs);
  const candidateReal = missingParts.length
    ? path.join(existingReal, ...missingParts)
    : existingReal;

  if (!isInsideRoot(projectRootReal, candidateReal)) {
    throw new Error(`Path escapes project root: ${userPath}`);
  }

  const rel = path.relative(projectRootReal, candidateReal);
  const resPath = `res://${rel.split(path.sep).join('/')}`;
  return { projectRootAbs: projectRootReal, absPath: candidateReal, resPath };
}
