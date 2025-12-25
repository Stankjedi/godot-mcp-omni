import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'fs';
import path from 'path';

export interface AuditEntry {
  ts: string;
  tool: string;
  args: unknown;
  ok: boolean;
  summary: string;
  details?: unknown;
  error?: unknown;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return n;
}

function rotateAuditLogIfNeeded(auditPath: string): void {
  const maxBytes = parsePositiveInt(
    process.env.GODOT_MCP_AUDIT_MAX_BYTES,
    5 * 1024 * 1024,
  );
  const backups = parsePositiveInt(process.env.GODOT_MCP_AUDIT_BACKUPS, 3);
  if (backups <= 0) return;

  let size = 0;
  try {
    size = statSync(auditPath).size;
  } catch {
    return;
  }
  if (size < maxBytes) return;

  // Rotate: audit.log -> audit.log.1 -> audit.log.2 ...
  for (let i = backups - 1; i >= 1; i -= 1) {
    const from = `${auditPath}.${i}`;
    const to = `${auditPath}.${i + 1}`;
    if (!existsSync(from)) continue;
    try {
      if (existsSync(to)) unlinkSync(to);
    } catch {
      // ignore
    }
    try {
      renameSync(from, to);
    } catch {
      // ignore
    }
  }

  const first = `${auditPath}.1`;
  try {
    if (existsSync(first)) unlinkSync(first);
  } catch {
    // ignore
  }
  try {
    renameSync(auditPath, first);
  } catch {
    // ignore
  }
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
    `Dangerous operation blocked (${name}). Set ALLOW_DANGEROUS_OPS=true to allow delete/move/export/build/project_settings changes.`,
  );
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v));
  if (!value || typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSensitiveKey(k)) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = redactSecrets(v);
  }
  return out;
}

const SENSITIVE_EXACT = new Set([
  'token',
  'id_token',
  'auth_token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'client_secret',
  'clientsecret',
  'secret_key',
  'private_key',
  'privatekey',
  'password',
  'passwd',
  'secret',
]);

const SENSITIVE_TOKENS = new Set([
  'token',
  'password',
  'passwd',
  'secret',
  'apikey',
  'clientsecret',
  'privatekey',
]);

const SENSITIVE_PAIRS: Array<[string, string]> = [
  ['access', 'token'],
  ['refresh', 'token'],
  ['api', 'key'],
  ['client', 'secret'],
  ['private', 'key'],
];

function tokenizeKey(key: string): string[] {
  const expanded = key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/gu, ' ')
    .trim();
  if (!expanded) return [];
  return expanded.toLowerCase().split(/\s+/gu).filter(Boolean);
}

function isSensitiveKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;

  const lowered = trimmed.toLowerCase();
  if (SENSITIVE_EXACT.has(lowered)) return true;

  const normalized = lowered.replace(/[^a-z0-9]+/gu, '_');
  if (SENSITIVE_EXACT.has(normalized)) return true;

  const tokens = tokenizeKey(trimmed);
  if (!tokens.length) return false;

  for (const token of tokens) {
    if (SENSITIVE_TOKENS.has(token)) return true;
  }

  const tokenSet = new Set(tokens);
  for (const [first, second] of SENSITIVE_PAIRS) {
    if (tokenSet.has(first) && tokenSet.has(second)) return true;
  }

  return false;
}

function normalizeForComparison(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

export function resolveInsideProject(
  projectPath: string,
  userPath: string,
): string {
  if (!projectPath) throw new Error('projectPath is required');
  if (!userPath) throw new Error('path is required');

  if (userPath.startsWith('user://')) {
    throw new Error(`Disallowed path scheme (user://): ${userPath}`);
  }

  let candidate = userPath;
  if (candidate.startsWith('res://'))
    candidate = candidate.slice('res://'.length);

  const resolvedProject = path.resolve(projectPath);
  const resolvedCandidate = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(resolvedProject, candidate);

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

function getStringParam(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = params[key];
  return typeof v === 'string' ? v : undefined;
}

function getNestedStringParam(
  params: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = getStringParam(params, k);
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function getTargetInfo(params: Record<string, unknown>): {
  targetType?: string;
  targetId?: string;
  method?: string;
} {
  return {
    targetType: getNestedStringParam(params, ['target_type', 'targetType']),
    targetId: getNestedStringParam(params, ['target_id', 'targetId']),
    method: getNestedStringParam(params, ['method']),
  };
}

function isDangerousRpcTarget(
  targetType: string | undefined,
  targetId: string | undefined,
): boolean {
  if (!targetType || !targetId) return false;
  if (targetType !== 'singleton') return false;
  const id = targetId.toLowerCase();
  return id === 'os' || id === 'projectsettings' || id === 'fileaccess';
}

export function assertEditorRpcAllowed(
  method: string,
  params: Record<string, unknown>,
  projectPath: string,
): void {
  if (!projectPath) throw new Error('projectPath is required');
  const m = method.trim();

  // Path allowlist for common editor RPCs.
  if (m === 'open_scene' || m === 'save_scene') {
    const p = getStringParam(params, 'path');
    if (typeof p === 'string' && p.length > 0)
      resolveInsideProject(projectPath, p);
  }

  if (m === 'instance_scene') {
    const p = getNestedStringParam(params, ['scene_path', 'scenePath']);
    if (typeof p === 'string' && p.length > 0)
      resolveInsideProject(projectPath, p);
    return;
  }

  if (
    m === 'begin_action' ||
    m === 'commit_action' ||
    m === 'abort_action' ||
    m === 'duplicate_node' ||
    m === 'reparent_node' ||
    m === 'disconnect_signal' ||
    m === 'scene_tree.query' ||
    m === 'selection.select_node' ||
    m === 'selection.clear'
  ) {
    return;
  }

  if (m === 'filesystem.scan') {
    // no path args
    return;
  }

  if (m === 'filesystem.reimport_files') {
    const files =
      params.files ??
      params.paths ??
      params.reimport_files ??
      params.reimportFiles;
    if (Array.isArray(files)) {
      for (const f of files) {
        if (typeof f !== 'string') continue;
        resolveInsideProject(projectPath, f);
      }
    }
    return;
  }

  // Generic RPC safety gates (call/set/get).
  if (m === 'call' || m === 'set' || m === 'get') {
    const { targetType, targetId, method: innerMethod } = getTargetInfo(params);
    const targetTypeNormalized =
      typeof targetType === 'string' ? targetType.trim() : undefined;
    const targetIdNormalized =
      typeof targetId === 'string' ? targetId.trim() : undefined;

    if (isDangerousRpcTarget(targetTypeNormalized, targetIdNormalized)) {
      // By default, block OS/ProjectSettings/FileAccess access; allow only when explicitly enabled.
      if (process.env.ALLOW_DANGEROUS_OPS !== 'true') {
        throw new Error(
          `Dangerous RPC blocked (${String(targetId)}.${String(innerMethod ?? m)}). Set ALLOW_DANGEROUS_OPS=true to allow OS/FileAccess/ProjectSettings access.`,
        );
      }
    }

    // Resource targets often use a path in target_id.
    if (targetTypeNormalized === 'resource' && targetIdNormalized) {
      resolveInsideProject(projectPath, targetIdNormalized);
    }

    // FileAccess APIs take the path as the first arg (validate even when dangerous ops are allowed).
    if (
      targetTypeNormalized === 'singleton' &&
      targetIdNormalized?.toLowerCase() === 'fileaccess'
    ) {
      const args = params.args;
      if (
        Array.isArray(args) &&
        typeof args[0] === 'string' &&
        args[0].length > 0
      ) {
        resolveInsideProject(projectPath, args[0]);
      }
    }

    // If the caller tries to pass any obvious path args, enforce allowlist.
    const pathArg = getNestedStringParam(params, [
      'path',
      'file_path',
      'filePath',
      'resource_path',
      'resourcePath',
      'scene_path',
      'scenePath',
    ]);
    if (pathArg) resolveInsideProject(projectPath, pathArg);
  }
}

export function appendAuditLog(projectPath: string, entry: AuditEntry): void {
  const auditDir = path.join(projectPath, '.godot_mcp');
  mkdirSync(auditDir, { recursive: true });

  const auditPath = path.join(auditDir, 'audit.log');
  rotateAuditLogIfNeeded(auditPath);
  appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' });
}
