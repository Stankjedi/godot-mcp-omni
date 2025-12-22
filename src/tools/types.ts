import type { ChildProcess } from 'child_process';

export interface ToolResponse {
  ok: boolean;
  summary: string;
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
