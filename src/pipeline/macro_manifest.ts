import fs from 'fs/promises';
import path from 'path';

export const MACRO_MANIFEST_RES_PATH = 'res://.godot_mcp/macro_manifest.json';

export type MacroManifest = {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  endedAt: string;
  macros: Array<{
    macroId: string;
    status: 'done' | 'failed' | 'skipped';
    operationsPlanned: number;
    operationsExecuted: number;
    created: string[];
    skippedExisting: string[];
    skippedUnchanged: string[];
    skippedDifferent: string[];
    summary?: string;
    details?: unknown;
  }>;
};

export function macroManifestAbsPath(projectPath: string): string {
  return path.join(projectPath, '.godot_mcp', 'macro_manifest.json');
}

export async function readMacroManifest(
  projectPath: string,
): Promise<MacroManifest | null> {
  const absPath = macroManifestAbsPath(projectPath);
  try {
    const text = await fs.readFile(absPath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !== 1
    ) {
      return null;
    }
    return parsed as MacroManifest;
  } catch {
    return null;
  }
}

export async function writeMacroManifest(
  projectPath: string,
  manifest: MacroManifest,
): Promise<void> {
  const absPath = macroManifestAbsPath(projectPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
