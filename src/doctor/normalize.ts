import type {
  DoctorCategory,
  DoctorIssue,
  DoctorIssueLocation,
  DoctorReportSummary,
  DoctorScanMeta,
  DoctorSeverity,
} from './types.js';

const SEVERITY_ORDER: Record<DoctorSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const CATEGORY_ORDER: Record<DoctorCategory, number> = {
  environment: 0,
  project: 1,
  assets: 2,
  scripts: 3,
  scenes: 4,
  uid: 5,
  export: 6,
  other: 99,
};

function asNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function normalizeSeverity(value: unknown): DoctorSeverity {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'error' || raw === 'warning' || raw === 'info') return raw;
  return 'info';
}

function normalizeCategory(value: unknown): DoctorCategory {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    raw === 'environment' ||
    raw === 'project' ||
    raw === 'assets' ||
    raw === 'scripts' ||
    raw === 'scenes' ||
    raw === 'uid' ||
    raw === 'export'
  ) {
    return raw;
  }
  return 'other';
}

function normalizeLocation(value: unknown): DoctorIssueLocation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const v = value as Record<string, unknown>;
  const out: DoctorIssueLocation = {};
  if (typeof v.file === 'string' && v.file.trim()) out.file = v.file.trim();
  const line =
    typeof v.line === 'number'
      ? v.line
      : typeof v.line === 'string'
        ? Number(v.line)
        : undefined;
  if (typeof line === 'number' && Number.isFinite(line) && line > 0)
    out.line = Math.floor(line);
  if (typeof v.nodePath === 'string' && v.nodePath.trim())
    out.nodePath = v.nodePath.trim();
  if (typeof v.uid === 'string' && v.uid.trim()) out.uid = v.uid.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

function stableKey(issue: DoctorIssue): string {
  return [
    issue.issueId,
    issue.severity,
    issue.category,
    issue.location?.file ?? '',
    issue.location?.line ?? '',
    issue.location?.nodePath ?? '',
    issue.location?.uid ?? '',
    issue.title,
    issue.message,
  ].join('|');
}

export function normalizeIssues(rawIssues: unknown): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const items = Array.isArray(rawIssues) ? rawIssues : [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const v = raw as Record<string, unknown>;
    const issue: DoctorIssue = {
      issueId: asNonEmptyString(v.issueId, 'UNKNOWN'),
      severity: normalizeSeverity(v.severity),
      category: normalizeCategory(v.category),
      title: asNonEmptyString(v.title, 'Untitled issue'),
      message: asNonEmptyString(v.message, ''),
      location: normalizeLocation(v.location),
      evidence:
        typeof v.evidence === 'string' && v.evidence.trim().length > 0
          ? v.evidence.trim()
          : undefined,
      suggestedFix:
        typeof v.suggestedFix === 'string' && v.suggestedFix.trim().length > 0
          ? v.suggestedFix.trim()
          : undefined,
      relatedMcpActions: Array.isArray(v.relatedMcpActions)
        ? v.relatedMcpActions.filter(
            (a): a is string => typeof a === 'string' && a.trim().length > 0,
          )
        : undefined,
    };
    issues.push(issue);
  }

  return issues;
}

export function dedupeAndSortIssues(issues: DoctorIssue[]): DoctorIssue[] {
  const seen = new Set<string>();
  const unique: DoctorIssue[] = [];
  for (const issue of issues) {
    const key = stableKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }

  unique.sort((a, b) => {
    const s =
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    if (s !== 0) return s;
    const c =
      (CATEGORY_ORDER[a.category] ?? 999) - (CATEGORY_ORDER[b.category] ?? 999);
    if (c !== 0) return c;
    const af = a.location?.file ?? '';
    const bf = b.location?.file ?? '';
    if (af !== bf) return af.localeCompare(bf);
    const al = a.location?.line ?? 0;
    const bl = b.location?.line ?? 0;
    if (al !== bl) return al - bl;
    if (a.issueId !== b.issueId) return a.issueId.localeCompare(b.issueId);
    if (a.title !== b.title) return a.title.localeCompare(b.title);
    return a.message.localeCompare(b.message);
  });

  return unique;
}

export function summarizeIssues(
  issues: DoctorIssue[],
  meta: DoctorScanMeta | null,
): DoctorReportSummary {
  const bySeverity: Record<DoctorSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  const byCategory: Record<string, number> = {};
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
  }

  const scanDurationMsRaw =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? (meta as Record<string, unknown>).scanDurationMs
      : undefined;
  const scanDurationMs =
    typeof scanDurationMsRaw === 'number'
      ? scanDurationMsRaw
      : typeof scanDurationMsRaw === 'string'
        ? Number(scanDurationMsRaw)
        : null;

  return {
    issueCountTotal: issues.length,
    issueCountBySeverity: bySeverity,
    issueCountByCategory: byCategory,
    scanDurationMs:
      typeof scanDurationMs === 'number' && Number.isFinite(scanDurationMs)
        ? Math.floor(scanDurationMs)
        : null,
  };
}

export function getTopIssues(
  issues: DoctorIssue[],
  maxCount: number,
): DoctorIssue[] {
  const n = Math.max(0, Math.floor(maxCount));
  if (n === 0) return [];
  return issues.slice(0, n);
}
