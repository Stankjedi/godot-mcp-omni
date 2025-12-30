import {
  asNonEmptyString,
  asOptionalRecord,
  asOptionalString,
} from '../../../validation.js';
import type {
  PixelManifestStep,
  PixelProjectProfile,
} from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';
import type { BaseToolHandlers } from '../../unified/shared.js';

import { nowIso } from '../manifest.js';
import { normalizeResPath } from '../paths.js';

import { analyzePixelProjectForTool, requireToolHandler } from './shared.js';

type ExportPreviewOutputs = {
  scenePath: string;
  layerName: string;
  outputPngPath: string;
  mapSize: { width: number; height: number } | null;
  tileMapping: Record<string, unknown>;
};

export async function runExportPreview(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
): Promise<{
  response: ToolResponse;
  outputs?: ExportPreviewOutputs;
  step: PixelManifestStep;
  profile: PixelProjectProfile;
}> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
  const spec = asOptionalRecord(argsObj.spec, 'spec') ?? {};
  const scenePath = normalizeResPath(
    asOptionalString(
      (spec as Record<string, unknown>).scenePath,
      'spec.scenePath',
    ) ?? 'res://scenes/generated/world/World.tscn',
  );
  const layerName = (
    asOptionalString(
      (spec as Record<string, unknown>).layerName,
      'spec.layerName',
    ) ?? 'Terrain'
  ).trim();
  const outputPngPath = normalizeResPath(
    asOptionalString(
      (spec as Record<string, unknown>).outputPngPath,
      'spec.outputPngPath',
    ) ?? 'res://assets/generated/previews/world_preview.png',
  );

  const startedAt = nowIso();
  const profile = await analyzePixelProjectForTool(ctx, projectPath);

  const headless = requireToolHandler(baseHandlers, 'godot_headless_op');
  const opResp = await headless({
    projectPath,
    operation: 'op_export_preview',
    params: { scenePath, layerName, outputPngPath },
  });

  const outputs: ExportPreviewOutputs = {
    scenePath,
    layerName,
    outputPngPath,
    mapSize:
      opResp.ok && opResp.details && typeof opResp.details === 'object'
        ? ((opResp.details as Record<string, unknown>).mapSize as {
            width: number;
            height: number;
          } | null)
        : null,
    tileMapping:
      opResp.ok && opResp.details && typeof opResp.details === 'object'
        ? (((opResp.details as Record<string, unknown>).tileMapping as Record<
            string,
            unknown
          > | null) ?? {})
        : {},
  };

  const response: ToolResponse = opResp.ok
    ? {
        ok: true,
        summary: 'Preview exported',
        details: { output: outputs, op: opResp },
      }
    : opResp;

  const step: PixelManifestStep = {
    name: 'pixel_export_preview',
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
