import fs from 'fs/promises';
import path from 'path';

import type { PixelManifest } from './pixel_types.js';

export const PIXEL_MANIFEST_RES_PATH = 'res://.godot_mcp/pixel_manifest.json';

export function pixelManifestAbsPath(projectPath: string): string {
  return path.join(projectPath, '.godot_mcp', 'pixel_manifest.json');
}

export async function readPixelManifest(
  projectPath: string,
): Promise<PixelManifest | null> {
  const absPath = pixelManifestAbsPath(projectPath);
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
    return parsed as PixelManifest;
  } catch {
    return null;
  }
}

export async function writePixelManifest(
  projectPath: string,
  manifest: PixelManifest,
): Promise<void> {
  const absPath = pixelManifestAbsPath(projectPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
