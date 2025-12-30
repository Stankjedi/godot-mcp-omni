import type { DoctorIssue, DoctorReport, DoctorSeverity } from './types.js';

const CATEGORY_TITLES: Record<string, string> = {
  environment: 'Environment',
  project: 'Project Settings',
  assets: 'Assets / Import',
  scripts: 'Scripts',
  scenes: 'Scenes / Resources',
  uid: 'UID',
  export: 'Export',
  other: 'Other',
};

const SEVERITY_BADGE: Record<DoctorSeverity, string> = {
  error: 'ERROR',
  warning: 'WARN',
  info: 'INFO',
};

function escapeMdTable(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
}

function locationText(issue: DoctorIssue): string {
  const file = issue.location?.file;
  const line = issue.location?.line;
  const node = issue.location?.nodePath;
  const uid = issue.location?.uid;
  const bits: string[] = [];
  if (file) bits.push(line ? `${file}:${line}` : file);
  if (node) bits.push(`node:${node}`);
  if (uid) bits.push(`uid:${uid}`);
  return bits.join(' ');
}

function issueAnchor(issue: DoctorIssue, index: number): string {
  const base =
    `${issue.severity}-${issue.category}-${issue.issueId}-${index + 1}`
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, '-')
      .replaceAll(/^-+|-+$/gu, '');
  return base.length > 0 ? base : `issue-${index + 1}`;
}

function renderIssueDetails(issue: DoctorIssue, index: number): string[] {
  const lines: string[] = [];
  const anchor = issueAnchor(issue, index);
  lines.push(`### ${SEVERITY_BADGE[issue.severity]} • ${issue.issueId}`);
  lines.push(`<a id="${anchor}"></a>`);
  lines.push('');
  lines.push(`- Category: \`${issue.category}\``);
  const loc = locationText(issue);
  if (loc) lines.push(`- Location: \`${loc}\``);
  if (issue.title.trim().length > 0) lines.push(`- Title: ${issue.title}`);
  if (issue.message.trim().length > 0)
    lines.push(`- Message: ${issue.message}`);
  if (issue.evidence && issue.evidence.trim().length > 0) {
    lines.push(`- Evidence: \`${issue.evidence.trim()}\``);
  }
  if (issue.suggestedFix && issue.suggestedFix.trim().length > 0) {
    lines.push(`- How to fix: ${issue.suggestedFix.trim()}`);
  }
  if (issue.relatedMcpActions && issue.relatedMcpActions.length > 0) {
    const uniq = Array.from(new Set(issue.relatedMcpActions)).sort();
    lines.push(
      `- Related MCP actions: ${uniq.map((a) => `\`${a}\``).join(', ')}`,
    );
  }
  lines.push('');
  return lines;
}

export function renderDoctorReportMarkdown(report: DoctorReport): string {
  const lines: string[] = [];

  lines.push('# Doctor Report');
  lines.push('');
  lines.push(`- Generated: \`${report.generatedAt}\``);
  lines.push(`- Project: \`${report.projectPath}\``);
  lines.push(`- Godot: \`${report.godotVersion ?? 'unknown'}\``);
  lines.push('');
  lines.push('## Scan Options');
  lines.push('');
  lines.push(`- includeAssets: \`${report.options.includeAssets}\``);
  lines.push(`- includeScripts: \`${report.options.includeScripts}\``);
  lines.push(`- includeScenes: \`${report.options.includeScenes}\``);
  lines.push(`- includeUID: \`${report.options.includeUID}\``);
  lines.push(`- includeExport: \`${report.options.includeExport}\``);
  lines.push(
    `- deepSceneInstantiate: \`${report.options.deepSceneInstantiate}\``,
  );
  lines.push(
    `- maxIssuesPerCategory: \`${report.options.maxIssuesPerCategory}\``,
  );
  lines.push(`- timeBudgetMs: \`${report.options.timeBudgetMs}\``);
  lines.push('');

  lines.push('## Executive Summary');
  lines.push('');
  lines.push(
    `- Total issues: \`${report.summary.issueCountTotal}\` (errors \`${report.summary.issueCountBySeverity.error}\`, warnings \`${report.summary.issueCountBySeverity.warning}\`, info \`${report.summary.issueCountBySeverity.info}\`)`,
  );
  lines.push(
    `- Scan duration: \`${report.summary.scanDurationMs ?? 'unknown'}\` ms`,
  );
  lines.push('');

  const topErrors = report.issues
    .filter((i) => i.severity === 'error')
    .slice(0, 10);
  if (topErrors.length > 0) {
    lines.push('### Top Errors');
    lines.push('');
    lines.push('| # | Issue | Location | Message |');
    lines.push('| -: | --- | --- | --- |');
    for (let i = 0; i < topErrors.length; i += 1) {
      const issue = topErrors[i];
      const loc = escapeMdTable(locationText(issue));
      const msg = escapeMdTable(issue.message);
      lines.push(
        `| ${i + 1} | \`${escapeMdTable(issue.issueId)}\` | \`${loc}\` | ${msg} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Issues By Category');
  lines.push('');

  const categories = [
    'environment',
    'project',
    'assets',
    'scripts',
    'scenes',
    'uid',
    'export',
    'other',
  ];

  for (const category of categories) {
    const bucket = report.issues.filter((i) => i.category === category);
    if (bucket.length === 0) continue;

    lines.push(`### ${CATEGORY_TITLES[category] ?? category}`);
    lines.push('');
    lines.push('| Severity | IssueId | Title | Location |');
    lines.push('| --- | --- | --- | --- |');
    for (let i = 0; i < bucket.length; i += 1) {
      const issue = bucket[i];
      const loc = locationText(issue);
      lines.push(
        `| \`${SEVERITY_BADGE[issue.severity]}\` | \`${escapeMdTable(issue.issueId)}\` | ${escapeMdTable(issue.title)} | \`${escapeMdTable(loc)}\` |`,
      );
    }
    lines.push('');

    lines.push(`#### ${CATEGORY_TITLES[category] ?? category} Details`);
    lines.push('');
    for (let i = 0; i < bucket.length; i += 1) {
      lines.push(...renderIssueDetails(bucket[i], i));
    }
  }

  // Fixed footer for determinism (avoid environment-specific noise).
  lines.push('---');
  lines.push('Generated by godot-mcp-omni doctor_report.');
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}
