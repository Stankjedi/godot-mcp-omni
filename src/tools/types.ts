export interface ToolResponse {
  ok: boolean;
  summary: string;
  details?: Record<string, unknown>;
  logs?: string[];
}

export interface GodotProcess {
  process: any;
  output: string[];
  errors: string[];
  projectPath?: string;
}

export type ToolHandler = (args: any) => Promise<ToolResponse>;

