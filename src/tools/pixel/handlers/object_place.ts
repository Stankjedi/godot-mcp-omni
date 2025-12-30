import { resolveInsideProject } from '../../../security.js';
import {
  ValidationError,
  asNonEmptyString,
  asOptionalNumber,
  asOptionalString,
  asRecord,
  valueType,
} from '../../../validation.js';

import { readPixelManifest } from '../../../pipeline/pixel_manifest.js';
import type {
  PixelManifestStep,
  PixelProjectProfile,
} from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';
import type { BaseToolHandlers } from '../../unified/shared.js';

import { readJsonIfExists } from '../files.js';
import { nowIso } from '../manifest.js';
import { normalizeResPath } from '../paths.js';
import { parseObjectPlacementInput, parseRepresentation } from '../spec.js';
import {
  atlasCoordFromTileName,
  defaultObjectAtlas,
  mappingFromMeta,
} from '../tiles.js';

import { analyzePixelProjectForTool, requireToolHandler } from './shared.js';

type ObjectPlaceOutputs = {
  worldScenePath: string;
  seed: number;
  placedTiles: unknown;
  placedScenes: unknown;
};

export async function runObjectPlace(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
): Promise<{
  response: ToolResponse;
  outputs?: ObjectPlaceOutputs;
  step: PixelManifestStep;
  profile: PixelProjectProfile;
}> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
  const worldScenePath = normalizeResPath(
    asNonEmptyString(argsObj.worldScenePath, 'worldScenePath'),
  );
  const spec = asRecord(argsObj.spec, 'spec');
  const seed = Math.floor(asOptionalNumber(argsObj.seed, 'seed') ?? 12345);

  const startedAt = nowIso();
  const profile = await analyzePixelProjectForTool(ctx, projectPath);
  void resolveInsideProject(projectPath, worldScenePath);

  const objectsValue = (spec as Record<string, unknown>).objects;
  if (!Array.isArray(objectsValue)) {
    throw new ValidationError(
      'spec.objects',
      `Invalid field "spec.objects": expected array, got ${valueType(objectsValue)}`,
      valueType(objectsValue),
    );
  }

  const manifest = await readPixelManifest(projectPath);
  const mapSize =
    manifest && typeof manifest.outputs === 'object' && manifest.outputs
      ? ((
          (manifest.outputs as Record<string, unknown>).world as
            | { mapSize?: { width: number; height: number } }
            | undefined
        )?.mapSize ?? { width: 256, height: 256 })
      : { width: 256, height: 256 };

  const tileSize = profile.pixel.tileSize || 16;

  // Tile mapping for avoid/on checks (best-effort).
  const tilesetMetaPath =
    manifest && typeof manifest.outputs === 'object' && manifest.outputs
      ? ((
          (manifest.outputs as Record<string, unknown>).tileset as
            | { metaJsonPath?: string }
            | undefined
        )?.metaJsonPath ?? undefined)
      : undefined;
  const metaAbs = tilesetMetaPath
    ? resolveInsideProject(projectPath, String(tilesetMetaPath))
    : null;
  const meta = metaAbs ? await readJsonIfExists(metaAbs) : null;
  const mapping = mappingFromMeta(meta);
  const waterAtlas = atlasCoordFromTileName('water', mapping) ?? { x: 2, y: 0 };

  const tileObjects: Array<Record<string, unknown>> = [];
  const sceneObjects: Array<Record<string, unknown>> = [];

  for (let i = 0; i < objectsValue.length; i += 1) {
    const obj = asRecord(objectsValue[i], `spec.objects[${i}]`);
    const id = asNonEmptyString(obj.id ?? obj.name, `spec.objects[${i}].id`);
    const kind = (
      asOptionalString(obj.kind, `spec.objects[${i}].kind`) ?? 'object'
    ).trim();
    const representation = parseRepresentation(
      obj.representation,
      `spec.objects[${i}].representation`,
    );

    const placement = parseObjectPlacementInput(
      obj.placement,
      `spec.objects[${i}].placement`,
    );
    const {
      density,
      onTiles,
      avoidTiles,
      preferNearTiles,
      preferDistance,
      preferMultiplier,
      minDistance,
    } = placement;

    const onAtlas = onTiles
      .map((t) => atlasCoordFromTileName(t, mapping))
      .filter(Boolean) as Array<{ x: number; y: number }>;
    const avoidAtlas = avoidTiles
      .map((t) => atlasCoordFromTileName(t, mapping))
      .filter(Boolean) as Array<{ x: number; y: number }>;
    const preferNearAtlas = preferNearTiles
      .map((t) => atlasCoordFromTileName(t, mapping))
      .filter(Boolean) as Array<{ x: number; y: number }>;

    if (representation === 'scene') {
      const scenePath = normalizeResPath(
        `res://scenes/generated/props/${id}.tscn`,
      );
      sceneObjects.push({
        id,
        name: id,
        scenePath,
        density,
        minDistance,
        onAtlas,
        avoidAtlas,
        preferNearAtlas,
        preferDistance,
        preferMultiplier,
      });
    } else {
      const atlas = defaultObjectAtlas(kind);
      tileObjects.push({
        id,
        name: id,
        density,
        atlas,
        minDistance,
        onAtlas,
        avoidAtlas: avoidAtlas.length > 0 ? avoidAtlas : [waterAtlas],
        preferNearAtlas,
        preferDistance,
        preferMultiplier,
      });
    }
  }

  const batch = requireToolHandler(baseHandlers, 'godot_headless_batch');

  let placedTiles: ToolResponse | null = null;
  let placedScenes: ToolResponse | null = null;

  if (tileObjects.length > 0) {
    placedTiles = await batch({
      projectPath,
      steps: [
        {
          operation: 'op_place_objects_tile',
          params: {
            scenePath: worldScenePath,
            mapSize,
            seed,
            terrainLayerName: 'Terrain',
            propsLayerName: 'Props',
            objects: tileObjects,
            sourceId: 0,
          },
        },
      ],
      stopOnError: true,
    });
  }

  if (sceneObjects.length > 0) {
    placedScenes = await batch({
      projectPath,
      steps: [
        {
          operation: 'op_place_objects_scene_instances',
          params: {
            scenePath: worldScenePath,
            mapSize,
            seed,
            tileSize,
            parentPath: 'Interactive',
            objects: sceneObjects,
          },
        },
      ],
      stopOnError: true,
    });
  }

  const response: ToolResponse =
    placedTiles?.ok || placedScenes?.ok
      ? {
          ok: true,
          summary: 'Objects placed',
          details: {
            placedTiles,
            placedScenes,
          },
        }
      : placedTiles && !placedTiles.ok
        ? placedTiles
        : (placedScenes ?? { ok: false, summary: 'Object placement failed' });

  const outputs: ObjectPlaceOutputs = {
    worldScenePath,
    seed,
    placedTiles,
    placedScenes,
  };

  const step: PixelManifestStep = {
    name: 'pixel_object_place',
    startedAt,
    finishedAt: nowIso(),
    ok: Boolean(response.ok),
    summary: response.summary,
    details: {
      ...(response.details ?? {}),
      output: outputs,
    },
  };

  return response.ok
    ? { response, outputs, step, profile }
    : { response, step, profile };
}
