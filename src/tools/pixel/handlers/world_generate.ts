import { resolveInsideProject } from '../../../security.js';
import { asNonEmptyString, asRecord } from '../../../validation.js';
import type {
  PixelManifestStep,
  PixelProjectProfile,
} from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';
import type { BaseToolHandlers } from '../../unified/shared.js';

import { fileExists, readJsonIfExists } from '../files.js';
import { nowIso } from '../manifest.js';
import {
  metaPathFromTilesetPath,
  normalizeResPath,
  tilesetPathFromName,
} from '../paths.js';
import { parseWorldSpecInput } from '../spec.js';
import { mappingFromMeta } from '../tiles.js';

import { analyzePixelProjectForTool, requireToolHandler } from './shared.js';

type WorldGenerateOutputs = {
  scenePath: string;
  tilesetPath: string;
  mapSize: { width: number; height: number };
  seed: number;
  layers: Array<{ name: string; type: string; zIndex: number }>;
};

export async function runWorldGenerate(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
): Promise<{
  response: ToolResponse;
  outputs?: WorldGenerateOutputs;
  step: PixelManifestStep;
  profile: PixelProjectProfile;
}> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
  const spec = asRecord(argsObj.spec, 'spec');

  const startedAt = nowIso();
  const profile = await analyzePixelProjectForTool(ctx, projectPath);

  const parsedSpec = parseWorldSpecInput(spec);
  const scenePath = parsedSpec.scenePath;
  void resolveInsideProject(projectPath, scenePath);

  let tilesetPath = parsedSpec.tilesetPath ?? '';
  const tilesetName = parsedSpec.tilesetName ?? '';
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
          name: 'pixel_world_generate',
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

  const mapSize = parsedSpec.mapSize;
  const seed = parsedSpec.seed;
  const layers = parsedSpec.layers;
  const biomes = parsedSpec.biomes;
  const placementRules = parsedSpec.placementRules;
  const organizeExisting = parsedSpec.organizeExisting;

  const metaResPath = metaPathFromTilesetPath(tilesetPath);
  const metaAbsPath = resolveInsideProject(projectPath, metaResPath);
  const meta = await readJsonIfExists(metaAbsPath);
  const tileMapping = mappingFromMeta(meta);

  const batch = requireToolHandler(baseHandlers, 'godot_headless_batch');
  const batchResp = await batch({
    projectPath,
    steps: [
      {
        operation: 'op_world_scene_ensure_layers',
        params: { scenePath, tilesetPath, layers, organizeExisting },
      },
      {
        operation: 'op_world_generate_tiles',
        params: {
          scenePath,
          layerName: 'Terrain',
          mapSize,
          seed,
          biomes,
          placementRules,
          tileMapping,
          tilesetPath,
        },
      },
    ],
    stopOnError: true,
  });

  const outputs: WorldGenerateOutputs = {
    scenePath,
    tilesetPath,
    mapSize,
    seed,
    layers,
  };

  const response: ToolResponse = batchResp.ok
    ? {
        ok: true,
        summary: 'World generated',
        details: { output: outputs, batch: batchResp },
      }
    : batchResp;

  const step: PixelManifestStep = {
    name: 'pixel_world_generate',
    startedAt,
    finishedAt: nowIso(),
    ok: Boolean(response.ok),
    summary: response.summary,
    details: {
      ...(response.details ?? {}),
      output: outputs,
      tileMapping,
      metaJsonPath: (await fileExists(metaAbsPath)) ? metaResPath : null,
    },
  };

  return response.ok
    ? { response, outputs, step, profile }
    : { response, step, profile };
}
