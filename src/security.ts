import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';

export interface AuditEntry {
  ts: string;
  tool: string;
  request: unknown;
  response: unknown;
}

export function isDangerousOp(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes('delete') ||
    n.includes('remove') ||
    n.includes('move') ||
    n.includes('rename') ||
    n.includes('export') ||
    n.includes('build') ||
    n.includes('project_settings') ||
    n === 'resave_resources' ||
    n === 'update_project_uids'
  );
}

export function assertDangerousOpsAllowed(name: string): void {
  if (!isDangerousOp(name)) return;
  if (process.env.ALLOW_DANGEROUS_OPS === 'true') return;

  throw new Error(
    `Dangerous operation blocked (${name}). Set ALLOW_DANGEROUS_OPS=true to allow delete/move/export/build/project_settings changes.`
  );
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v));
  if (!value || typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase().includes('token')) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = redactSecrets(v);
  }
  return out;
}

function normalizeForComparison(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

export function resolveInsideProject(projectPath: string, userPath: string): string {
  if (!projectPath) throw new Error('projectPath is required');
  if (!userPath) throw new Error('path is required');

  if (userPath.startsWith('user://')) {
    throw new Error(`Disallowed path scheme (user://): ${userPath}`);
  }

  let candidate = userPath;
  if (candidate.startsWith('res://')) candidate = candidate.slice('res://'.length);

  const resolvedProject = path.resolve(projectPath);
  const resolvedCandidate = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(resolvedProject, candidate);

  const rel = path.relative(resolvedProject, resolvedCandidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${userPath}`);
  }

  const projCmp = normalizeForComparison(resolvedProject);
  const candCmp = normalizeForComparison(resolvedCandidate);
  if (!candCmp.startsWith(projCmp)) {
    throw new Error(`Path escapes project root: ${userPath}`);
  }

  return resolvedCandidate;
}

export function appendAuditLog(projectPath: string, entry: AuditEntry): void {
  const auditDir = path.join(projectPath, '.godot_mcp');
  mkdirSync(auditDir, { recursive: true });

  const auditPath = path.join(auditDir, 'audit.log');
  appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' });
}

