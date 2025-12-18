import type { EditorBridgeClient } from '../editor_bridge_client.js';
import type { GodotProcess } from './types.js';

export interface ServerContext {
  logDebug: (message: string) => void;

  assertValidProject: (projectPath: string) => void;
  ensureNoTraversal: (p: string) => void;
  ensureGodotPath: (customGodotPath?: string) => Promise<string>;
  convertCamelToSnakeCase: (params: any) => any;
  operationsScriptPath: string;

  getActiveProcess: () => GodotProcess | null;
  setActiveProcess: (proc: GodotProcess | null) => void;

  getEditorClient: () => EditorBridgeClient | null;
  setEditorClient: (client: EditorBridgeClient | null) => void;
  getEditorProjectPath: () => string | null;
  setEditorProjectPath: (projectPath: string | null) => void;
}

