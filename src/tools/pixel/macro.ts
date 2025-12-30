import { createHash } from 'crypto';

import axios from 'axios';

import type { PixelProjectProfile } from '../../pipeline/pixel_types.js';
import {
  ValidationError,
  asNonEmptyString,
  asOptionalRecord,
  asOptionalString,
  asRecord,
  valueType,
} from '../../validation.js';
import { normalizeResPath } from './paths.js';
import {
  parseTilemapSpec,
  parseWorldSpecInput,
  validateObjectSpecInput,
} from './spec.js';

export type MacroStep = { tool: string; args: Record<string, unknown> };

export const SUPPORTED_PIXEL_MACRO_TOOLS = new Set([
  'pixel_tilemap_generate',
  'pixel_world_generate',
  'pixel_layer_ensure',
  'pixel_object_generate',
  'pixel_object_place',
  'pixel_export_preview',
  'pixel_smoke_test',
] as const);

export type GoalToSpecOutputs = {
  adapter: 'builtin' | 'http' | 'explicit_plan';
  plan: MacroStep[];
  derived: {
    tilemapSpec: Record<string, unknown> | null;
    worldSpec: Record<string, unknown> | null;
    objectSpec: Record<string, unknown> | null;
    worldScenePath: string | null;
  };
  raw?: unknown;
};

export function stableJsonStringify(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean') return String(value);
  if (Array.isArray(value))
    return `[${value.map((v) => stableJsonStringify(v)).join(',')}]`;
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableJsonStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

export function deriveSpecsFromPlan(
  plan: MacroStep[],
): GoalToSpecOutputs['derived'] {
  let tilemapSpec: Record<string, unknown> | null = null;
  let worldSpec: Record<string, unknown> | null = null;
  let objectSpec: Record<string, unknown> | null = null;
  let worldScenePath: string | null = null;

  for (const step of plan) {
    if (step.tool === 'pixel_tilemap_generate') {
      const spec = asOptionalRecord(step.args.spec, 'plan[].args.spec') ?? null;
      if (spec) tilemapSpec = spec;
    } else if (step.tool === 'pixel_world_generate') {
      const spec = asOptionalRecord(step.args.spec, 'plan[].args.spec') ?? null;
      if (spec) worldSpec = spec;
    } else if (step.tool === 'pixel_object_generate') {
      const spec = asOptionalRecord(step.args.spec, 'plan[].args.spec') ?? null;
      if (spec) objectSpec = spec;
    } else if (step.tool === 'pixel_object_place') {
      const p = asOptionalString(
        step.args.worldScenePath,
        'plan[].worldScenePath',
      );
      if (p) worldScenePath = normalizeResPath(p);
    }
  }

  return { tilemapSpec, worldSpec, objectSpec, worldScenePath };
}

export function parseMacroPlanInput(
  value: unknown,
  fieldName: string,
): MacroStep[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected array, got ${valueType(value)}`,
      valueType(value),
    );
  }

  const plan: MacroStep[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const s = asRecord(value[i], `${fieldName}[${i}]`);
    const tool = asNonEmptyString(s.tool, `${fieldName}[${i}].tool`);
    if (!SUPPORTED_PIXEL_MACRO_TOOLS.has(tool as never)) {
      throw new ValidationError(
        `${fieldName}[${i}].tool`,
        `Unsupported macro step tool "${tool}"`,
        'string',
      );
    }

    const stepArgs = asOptionalRecord(s.args, `${fieldName}[${i}].args`) ?? {};

    // Minimal schema validation to fail early with a helpful error.
    if (tool === 'pixel_tilemap_generate') {
      const spec = asRecord(stepArgs.spec, `${fieldName}[${i}].args.spec`);
      void parseTilemapSpec(spec, 16);
    } else if (
      tool === 'pixel_world_generate' ||
      tool === 'pixel_layer_ensure'
    ) {
      const spec = asRecord(stepArgs.spec, `${fieldName}[${i}].args.spec`);
      void parseWorldSpecInput(spec);
    } else if (tool === 'pixel_object_generate') {
      const spec = asRecord(stepArgs.spec, `${fieldName}[${i}].args.spec`);
      void validateObjectSpecInput(spec, 'spec');
    } else if (tool === 'pixel_object_place') {
      void asNonEmptyString(
        stepArgs.worldScenePath,
        `${fieldName}[${i}].args.worldScenePath`,
      );
      const spec = asRecord(stepArgs.spec, `${fieldName}[${i}].args.spec`);
      void validateObjectSpecInput(spec, 'spec');
    }

    plan.push({ tool, args: stepArgs });
  }

  return plan;
}

export async function generatePlanFromGoalViaHttp(
  goal: string,
  profile: PixelProjectProfile,
  timeoutMs: number,
): Promise<GoalToSpecOutputs> {
  const url = (process.env.SPEC_GEN_URL ?? '').trim();
  if (!url) throw new Error('SPEC_GEN_URL is not set');

  const headerName = (process.env.SPEC_GEN_AUTH_HEADER ?? '').trim();
  const headerValue = (process.env.SPEC_GEN_AUTH_VALUE ?? '').trim();
  const headers =
    headerName && headerValue ? { [headerName]: headerValue } : undefined;

  const resp = await axios.post(
    url,
    {
      schemaVersion: 1,
      goal,
      profile,
      supportedTools: Array.from(SUPPORTED_PIXEL_MACRO_TOOLS.values()),
    },
    {
      timeout: timeoutMs,
      headers,
      validateStatus: () => true,
    },
  );

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(
      `Spec generation HTTP ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`,
    );
  }

  const raw = resp.data as unknown;
  const parsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return raw;
          }
        })()
      : raw;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Spec generation response must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;
  let planValue: unknown = obj.plan ?? obj.steps;

  if (!planValue) {
    // Allow "tilemapSpec/worldSpec/objectSpec" style outputs and convert to a plan.
    const tilemapSpec =
      asOptionalRecord(obj.tilemapSpec ?? obj.tilemap, 'result.tilemapSpec') ??
      null;
    const worldSpec =
      asOptionalRecord(obj.worldSpec ?? obj.world, 'result.worldSpec') ?? null;
    const objectSpec =
      asOptionalRecord(obj.objectSpec ?? obj.objects, 'result.objectSpec') ??
      null;

    const synthesized: unknown[] = [];
    if (tilemapSpec)
      synthesized.push({
        tool: 'pixel_tilemap_generate',
        args: { spec: tilemapSpec },
      });
    if (worldSpec)
      synthesized.push({
        tool: 'pixel_world_generate',
        args: { spec: worldSpec },
      });
    if (objectSpec) {
      synthesized.push({
        tool: 'pixel_object_generate',
        args: { spec: objectSpec },
      });
      synthesized.push({
        tool: 'pixel_object_place',
        args: {
          worldScenePath:
            worldSpec && typeof worldSpec.scenePath === 'string'
              ? worldSpec.scenePath
              : 'res://scenes/generated/world/World.tscn',
          spec: objectSpec,
        },
      });
    }
    planValue = synthesized;
  }

  const plan = parseMacroPlanInput(planValue, 'result.plan');
  const derived = deriveSpecsFromPlan(plan);
  return { adapter: 'http', plan, derived, raw: parsed };
}

export function normalizeMacroPlanFromGoal(goal: string): MacroStep[] {
  const g = goal.toLowerCase();
  const wantsTilemap =
    g.includes('타일맵') ||
    g.includes('tilemap') ||
    g.includes('tileset') ||
    g.includes('tile set');
  const wantsWorld =
    g.includes('월드') ||
    g.includes('world') ||
    g.includes('맵') ||
    g.includes('map');
  const wantsObjects =
    g.includes('나무') ||
    g.includes('tree') ||
    g.includes('돌') ||
    g.includes('rock') ||
    g.includes('건물') ||
    g.includes('building') ||
    g.includes('object');

  const runAll = !wantsTilemap && !wantsWorld && !wantsObjects;

  let theme: string | undefined;
  if (g.includes('숲') || g.includes('forest')) theme = 'forest';
  else if (g.includes('초원') || g.includes('grass')) theme = 'grassland';
  else if (g.includes('강') || g.includes('river')) theme = 'river';

  const sizeMatch = goal.match(/(\d+)\s*[x×]\s*(\d+)/iu);
  const mapSize = sizeMatch
    ? {
        width: Math.max(1, Number.parseInt(sizeMatch[1] ?? '256', 10)),
        height: Math.max(1, Number.parseInt(sizeMatch[2] ?? '256', 10)),
      }
    : { width: 256, height: 256 };

  const densityMatch = goal.match(
    /(?:밀도|density)\s*[:=]?\s*([0-9]*\.?[0-9]+)/iu,
  );
  const requestedDensity = densityMatch
    ? Number.parseFloat(densityMatch[1] ?? '')
    : Number.NaN;
  const baseDensity = Number.isFinite(requestedDensity)
    ? Math.min(1, Math.max(0, requestedDensity))
    : null;

  const preferNearRiver =
    (g.includes('강') && (g.includes('주변') || g.includes('근처'))) ||
    (g.includes('river') && (g.includes('near') || g.includes('around')));
  const preferNear = preferNearRiver
    ? { preferNearTiles: ['water'], preferDistance: 6, preferMultiplier: 2 }
    : {};

  const steps: MacroStep[] = [];

  if (runAll || wantsTilemap) {
    steps.push({
      tool: 'pixel_tilemap_generate',
      args: {
        spec: {
          name: 'pixel_base',
          tileSize: 16,
          sheet: { columns: 16, rows: 16 },
          ...(theme ? { theme } : {}),
        },
      },
    });
  }

  if (runAll || wantsWorld) {
    steps.push({
      tool: 'pixel_world_generate',
      args: {
        spec: {
          scenePath: 'res://scenes/generated/world/World.tscn',
          tilesetName: 'pixel_base',
          mapSize,
          seed: 12345,
        },
      },
    });
  }

  if (runAll || wantsObjects) {
    const objects: Array<Record<string, unknown>> = [];
    if (g.includes('나무') || g.includes('tree')) {
      objects.push({
        id: 'tree_small',
        kind: 'tree',
        representation: 'tile',
        placement: {
          density: baseDensity ?? 0.15,
          minDistance: 2,
          onTiles: ['grass', 'forest', 'forest_floor'],
          avoidTiles: ['water', 'path'],
          ...preferNear,
        },
      });
    }
    if (g.includes('돌') || g.includes('rock')) {
      objects.push({
        id: 'rock_small',
        kind: 'rock',
        representation: 'tile',
        placement: {
          density: baseDensity ?? 0.08,
          minDistance: 1,
          onTiles: ['grass', 'grassland'],
          avoidTiles: ['water', 'path'],
          ...preferNear,
        },
      });
    }
    if (g.includes('건물') || g.includes('building')) {
      objects.push({
        id: 'house_small',
        kind: 'building',
        representation: 'scene',
        sizePx: { w: 64, h: 64 },
        placement: {
          density: baseDensity ?? 0.01,
          minDistance: 8,
          onTiles: ['grass', 'forest', 'forest_floor'],
          avoidTiles: ['water', 'path'],
          ...preferNear,
        },
      });
    }
    if (objects.length === 0) {
      objects.push({
        id: 'rock_small',
        kind: 'rock',
        representation: 'tile',
        placement: {
          density: baseDensity ?? 0.05,
          minDistance: 1,
          onTiles: ['grass', 'grassland'],
          avoidTiles: ['water', 'path'],
          ...preferNear,
        },
      });
    }

    steps.push({ tool: 'pixel_object_generate', args: { spec: { objects } } });
    steps.push({
      tool: 'pixel_object_place',
      args: {
        worldScenePath: 'res://scenes/generated/world/World.tscn',
        spec: { objects },
      },
    });
  }

  return steps;
}
