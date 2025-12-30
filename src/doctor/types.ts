export type DoctorSeverity = 'error' | 'warning' | 'info';

export type DoctorCategory =
  | 'environment'
  | 'project'
  | 'assets'
  | 'scripts'
  | 'scenes'
  | 'uid'
  | 'export'
  | 'other';

export type DoctorIssueLocation = {
  file?: string;
  line?: number;
  nodePath?: string;
  uid?: string;
};

export type DoctorIssue = {
  issueId: string;
  severity: DoctorSeverity;
  category: DoctorCategory;
  title: string;
  message: string;
  location?: DoctorIssueLocation;
  evidence?: string;
  suggestedFix?: string;
  relatedMcpActions?: string[];
};

export type DoctorScanOptions = {
  includeAssets?: boolean;
  includeScripts?: boolean;
  includeScenes?: boolean;
  includeUID?: boolean;
  includeExport?: boolean;
  maxIssuesPerCategory?: number;
  timeBudgetMs?: number;
  deepSceneInstantiate?: boolean;
};

export type DoctorScanMeta = Record<string, unknown>;

export type DoctorScanResult = {
  meta?: DoctorScanMeta;
  issues: DoctorIssue[];
};

export type DoctorReportSummary = {
  issueCountTotal: number;
  issueCountBySeverity: Record<DoctorSeverity, number>;
  issueCountByCategory: Record<string, number>;
  scanDurationMs: number | null;
};

export type DoctorReport = {
  generatedAt: string;
  projectPath: string;
  godotVersion: string | null;
  options: Required<DoctorScanOptions>;
  meta: DoctorScanMeta | null;
  issues: DoctorIssue[];
  summary: DoctorReportSummary;
};
