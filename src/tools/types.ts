import type { ChildProcess } from 'child_process';

export type ToolErrorV1 = {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  suggestedFix?: string;
};

export type ToolMetaV1 = {
  tool: string;
  action: string | null;
  correlationId: string;
  durationMs: number;
};

export interface ToolResponse {
  ok: boolean;
  summary: string;
  action?: string;
  runId?: string;
  timestamp?: string;
  correlationId?: string;
  warnings?: string[];
  errors?: Array<{
    code: string;
    message: string;
    details?: unknown;
  }>;
  result?: unknown;
  error?: ToolErrorV1 | null;
  meta?: ToolMetaV1;
  execution?: Record<string, unknown>;
  files?: Array<{
    kind: string;
    pathAbs: string;
    resPath: string | null;
    bytes?: number;
  }>;
  details?: Record<string, unknown>;
  logs?: string[];
}

export interface GodotProcess {
  process: ChildProcess;
  output: string[];
  errors: string[];
  projectPath?: string;
}

export type ToolHandler = (args: unknown) => Promise<ToolResponse>;
