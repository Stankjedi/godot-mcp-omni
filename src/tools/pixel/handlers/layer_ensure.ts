import { resolveInsideProject } from '../../../security.js';
import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalString,
  asRecord,
} from '../../../validation.js';
import type {
  PixelManifestStep,
  PixelProjectProfile,
} from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';
import type { BaseToolHandlers } from '../../unified/shared.js';

import { nowIso } from '../manifest.js';
import { normalizeResPath, tilesetPathFromName } from '../paths.js';
import { parseWorldLayers } from '../spec.js';

import { analyzePixelProjectForTool, requireToolHandler } from './shared.js';

type LayerEnsureOutputs = {
  scenePath: string;
  tilesetPath: string;
  layers: Array<{ name: string; type: string; zIndex: number }>;
};

export async function runLayerEnsure(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
): Promise<{
  response: ToolResponse;
  outputs?: LayerEnsureOutputs;
  step: PixelManifestStep;
  profile: PixelProjectProfile;
}> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
  const spec = asRecord(argsObj.spec, 'spec');

  const startedAt = nowIso();
  const profile = await analyzePixelProjectForTool(ctx, projectPath);

  const scenePath = normalizeResPath(
    asOptionalString(
      spec.scenePath ?? (spec as Record<string, unknown>).scene_path,
      'spec.scenePath',
    ) ?? 'res://scenes/generated/world/World.tscn',
  );
  void resolveInsideProject(projectPath, scenePath);

  let tilesetPath =
    asOptionalString(
      spec.tilesetPath ?? (spec as Record<string, unknown>).tileset_path,
      'spec.tilesetPath',
    )?.trim() ?? '';
  const tilesetName =
    asOptionalString(
      spec.tilesetName ?? (spec as Record<string, unknown>).tileset_name,
      'spec.tilesetName',
    )?.trim() ?? '';
  if (!tilesetPath && tilesetName)
    tilesetPath = tilesetPathFromName(tilesetName);
  if (!tilesetPath) {
    const candidate = profile.existing.tilesets[0];
    if (!candidate) {
      const response: ToolResponse = {
        ok: false,
        summary: 'No tilesetPath provided and no existing TileSet detected',
        details: {
          suggestions: [
            'Run pixel_manager(action="tilemap_generate") first, or pass spec.tilesetPath.',
          ],
        },
      };
      return {
        response,
        step: {
          name: 'pixel_layer_ensure',
          startedAt,
          finishedAt: nowIso(),
          ok: false,
          summary: response.summary,
          details: response.details,
        },
        profile,
      };
    }
    tilesetPath = candidate;
  }
  tilesetPath = normalizeResPath(tilesetPath);
  void resolveInsideProject(projectPath, tilesetPath);

  const layers = parseWorldLayers(spec.layers);
  const organizeExisting =
    asOptionalBoolean(
      spec.organizeExisting ??
        (spec as Record<string, unknown>).organize_existing,
      'spec.organizeExisting',
    ) ?? true;

  const headless = requireToolHandler(baseHandlers, 'godot_headless_op');
  const opResp = await headless({
    projectPath,
    operation: 'op_world_scene_ensure_layers',
    params: { scenePath, tilesetPath, layers, organizeExisting },
  });

  const outputs: LayerEnsureOutputs = { scenePath, tilesetPath, layers };
  const response: ToolResponse = opResp.ok
    ? {
        ok: true,
        summary: 'World layers ensured',
        details: { output: outputs, op: opResp },
      }
    : opResp;

  const step: PixelManifestStep = {
    name: 'pixel_layer_ensure',
    startedAt,
    finishedAt: nowIso(),
    ok: Boolean(response.ok),
    summary: response.summary,
    details: { ...(response.details ?? {}), output: outputs },
  };

  return response.ok
    ? { response, outputs, step, profile }
    : { response, step, profile };
}
