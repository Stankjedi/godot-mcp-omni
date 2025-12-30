import { resolveInsideProject } from '../../../security.js';
import { asNonEmptyString } from '../../../validation.js';

import {
  PIXEL_MANIFEST_RES_PATH,
  readPixelManifest,
} from '../../../pipeline/pixel_manifest.js';

import type { ToolResponse } from '../../types.js';

export async function runManifestGet(
  argsObj: Record<string, unknown>,
): Promise<ToolResponse> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
  void resolveInsideProject(projectPath, PIXEL_MANIFEST_RES_PATH);

  const manifest = await readPixelManifest(projectPath);
  if (!manifest) {
    return {
      ok: false,
      summary: 'Pixel manifest not found',
      details: {
        manifestPath: PIXEL_MANIFEST_RES_PATH,
        suggestions: [
          'Run pixel_macro_run (or any pixel_* tool that writes a manifest) first.',
        ],
      },
    };
  }

  return {
    ok: true,
    summary: 'Pixel manifest loaded',
    details: { manifestPath: PIXEL_MANIFEST_RES_PATH, manifest },
  };
}
