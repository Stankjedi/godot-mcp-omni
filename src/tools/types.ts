import type { ChildProcess } from 'child_process';

export interface ToolResponse {
  ok: boolean;
  summary: string;
  action?: string;
  runId?: string;
  timestamp?: string;
  warnings?: string[];
  errors?: Array<{
    code: string;
    message: string;
    details?: unknown;
  }>;
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
