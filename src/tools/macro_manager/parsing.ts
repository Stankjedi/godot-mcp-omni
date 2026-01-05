import {
  ValidationError,
  asOptionalBoolean,
  asOptionalRecord,
  asOptionalString,
  valueType,
} from '../../validation.js';

import type { PixelMacroConfig } from './types.js';

export function asOptionalArray(
  value: unknown,
  fieldName: string,
): unknown[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected array`,
      valueType(value),
    );
  }
  return value;
}

export function parsePixelMacroConfig(
  argsObj: Record<string, unknown>,
): PixelMacroConfig | null {
  const pixelObj = asOptionalRecord(argsObj.pixel, 'pixel');
  if (!pixelObj) return null;

  const config: PixelMacroConfig = {};

  const goal = asOptionalString(pixelObj.goal, 'pixel.goal')?.trim();
  if (goal) config.goal = goal;

  const planRaw = pixelObj.plan;
  if (planRaw !== undefined && planRaw !== null) {
    if (!Array.isArray(planRaw)) {
      throw new ValidationError(
        'pixel.plan',
        'Invalid field "pixel.plan": expected array',
        valueType(planRaw),
      );
    }
    config.plan = planRaw;
  }

  config.seed = pixelObj.seed as number | undefined;
  config.failFast = asOptionalBoolean(pixelObj.failFast, 'pixel.failFast');
  config.allowExternalTools = asOptionalBoolean(
    pixelObj.allowExternalTools,
    'pixel.allowExternalTools',
  );
  config.specGenTimeoutMs = pixelObj.specGenTimeoutMs as number | undefined;
  config.exportPreview = asOptionalBoolean(
    pixelObj.exportPreview,
    'pixel.exportPreview',
  );
  config.smokeTest = asOptionalBoolean(pixelObj.smokeTest, 'pixel.smokeTest');
  config.smokeWaitMs = pixelObj.smokeWaitMs as number | undefined;
  config.previewOutputPngPath =
    asOptionalString(
      pixelObj.previewOutputPngPath,
      'pixel.previewOutputPngPath',
    ) ?? undefined;

  config.layerName =
    asOptionalString(pixelObj.layerName, 'pixel.layerName') ?? undefined;
  config.outputPngPath =
    asOptionalString(pixelObj.outputPngPath, 'pixel.outputPngPath') ??
    undefined;
  config.scenePath =
    asOptionalString(pixelObj.scenePath, 'pixel.scenePath') ?? undefined;

  config.dryRun = asOptionalBoolean(pixelObj.dryRun, 'pixel.dryRun');
  config.forceRegenerate = asOptionalBoolean(
    pixelObj.forceRegenerate,
    'pixel.forceRegenerate',
  );

  if (!config.goal && !config.plan) {
    throw new ValidationError(
      'pixel',
      'Invalid field "pixel": expected pixel.goal or pixel.plan',
      valueType(pixelObj),
    );
  }

  return config;
}

export function guessPixelWorldScenePath(pixel: PixelMacroConfig): string {
  const defaultWorldScenePath = 'res://scenes/generated/world/World.tscn';
  if (!pixel.plan) return defaultWorldScenePath;

  for (const raw of pixel.plan) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const step = raw as Record<string, unknown>;
    const args = step.args;
    if (!args || typeof args !== 'object' || Array.isArray(args)) continue;

    const tool = step.tool;
    const action =
      tool === 'pixel_manager'
        ? (args as Record<string, unknown>).action
        : tool === 'pixel_world_generate'
          ? 'world_generate'
          : null;
    if (
      typeof action !== 'string' ||
      action.trim().toLowerCase() !== 'world_generate'
    ) {
      continue;
    }

    const spec = (args as Record<string, unknown>).spec;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
    const scenePathRaw =
      (spec as Record<string, unknown>).scenePath ??
      (spec as Record<string, unknown>).scene_path;
    if (typeof scenePathRaw === 'string' && scenePathRaw.trim().length > 0) {
      return scenePathRaw.trim();
    }
  }

  return defaultWorldScenePath;
}

export function parseMacroIds(argsObj: Record<string, unknown>): string[] {
  const macroId = asOptionalString(argsObj.macroId, 'macroId')?.trim();
  const macrosValue = asOptionalArray(argsObj.macros, 'macros');

  const out: string[] = [];
  if (macroId) out.push(macroId);

  if (macrosValue) {
    for (let i = 0; i < macrosValue.length; i += 1) {
      const raw = macrosValue[i];
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed) out.push(trimmed);
        continue;
      }
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const obj = raw as Record<string, unknown>;
        const id =
          asOptionalString(obj.macroId, `macros[${i}].macroId`)?.trim() ??
          asOptionalString(obj.id, `macros[${i}].id`)?.trim();
        if (id) out.push(id);
        continue;
      }
      throw new ValidationError(
        `macros[${i}]`,
        'Invalid macros[] entry: expected string or object with macroId',
        valueType(raw),
      );
    }
  }

  const uniq = Array.from(new Set(out));
  return uniq.filter(Boolean);
}
