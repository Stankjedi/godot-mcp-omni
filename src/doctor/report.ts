import type {
  DoctorIssue,
  DoctorReport,
  DoctorScanMeta,
  DoctorScanOptions,
} from './types.js';
import { dedupeAndSortIssues, summarizeIssues } from './normalize.js';

export function withDoctorDefaults(
  options: DoctorScanOptions | null,
): Required<DoctorScanOptions> {
  return {
    includeAssets: options?.includeAssets ?? true,
    includeScripts: options?.includeScripts ?? true,
    includeScenes: options?.includeScenes ?? true,
    includeUID: options?.includeUID ?? true,
    includeExport: options?.includeExport ?? false,
    maxIssuesPerCategory: Math.max(
      1,
      Math.floor(options?.maxIssuesPerCategory ?? 200),
    ),
    timeBudgetMs: Math.max(1, Math.floor(options?.timeBudgetMs ?? 180000)),
    deepSceneInstantiate: options?.deepSceneInstantiate ?? false,
  };
}

export function buildDoctorReport(args: {
  projectPath: string;
  godotVersion: string | null;
  options: DoctorScanOptions | null;
  meta: DoctorScanMeta | null;
  issues: DoctorIssue[];
}): DoctorReport {
  const normalizedOptions = withDoctorDefaults(args.options);
  const sorted = dedupeAndSortIssues(args.issues);
  const summary = summarizeIssues(sorted, args.meta);
  return {
    generatedAt: new Date().toISOString(),
    projectPath: args.projectPath,
    godotVersion: args.godotVersion,
    options: normalizedOptions,
    meta: args.meta,
    issues: sorted,
    summary,
  };
}
