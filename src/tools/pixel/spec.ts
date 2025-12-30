import {
  ValidationError,
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNumber,
  asOptionalRecord,
  asOptionalString,
  asRecord,
  valueType,
} from '../../validation.js';
import type {
  PixelBiomeRule,
  PixelPathRules,
  PixelPlacementRules,
} from '../../pipeline/pixel_types.js';
import { normalizeResPath, tilemapDefaultPaths } from './paths.js';

export type TilemapGenerateOutputs = {
  name: string;
  theme?: string;
  tileSize: number;
  sheet: { columns: number; rows: number };
  sheetPngPath: string;
  tilesetPath: string;
  metaJsonPath: string;
  asepriteJsonPath?: string;
};

export type ParsedTilemapSpec = {
  name: string;
  theme?: string;
  tileSize: number;
  columns: number;
  rows: number;
  output: TilemapGenerateOutputs;
};

export type ParsedWorldSpecInput = {
  scenePath: string;
  tilesetPath?: string;
  tilesetName?: string;
  mapSize: { width: number; height: number };
  seed: number;
  layers: Array<{ name: string; type: string; zIndex: number }>;
  biomes?: PixelBiomeRule[];
  placementRules: PixelPlacementRules;
  organizeExisting: boolean;
};

function normalizePositiveInt(
  value: unknown,
  fieldName: string,
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  const n = asOptionalNumber(value, fieldName);
  if (n === undefined) return fallback;
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected positive integer`,
      valueType(value),
    );
  }
  return n;
}

function normalizeNonNegativeNumber(
  value: unknown,
  fieldName: string,
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  const n = asOptionalNumber(value, fieldName);
  if (n === undefined) return fallback;
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected non-negative number`,
      valueType(value),
    );
  }
  return n;
}

function normalizeOptionalNonNegativeNumber(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = asOptionalNumber(value, fieldName);
  if (n === undefined) return undefined;
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected non-negative number`,
      valueType(value),
    );
  }
  return n;
}

function normalizeOptionalPositiveNumber(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = asOptionalNumber(value, fieldName);
  if (n === undefined) return undefined;
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected positive number`,
      valueType(value),
    );
  }
  return n;
}

function normalizeOptionalPositiveInt(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = asOptionalNumber(value, fieldName);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected positive integer`,
      valueType(value),
    );
  }
  return n;
}

function normalizeOptionalNonNegativeInt(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = asOptionalNumber(value, fieldName);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n) || n < 0) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected non-negative integer`,
      valueType(value),
    );
  }
  return n;
}

function pickFirstDefined<T>(
  ...values: Array<T | null | undefined>
): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export function parseTilemapSpec(
  spec: Record<string, unknown>,
  defaultTileSize: number,
): ParsedTilemapSpec {
  const name = asNonEmptyString(spec.name, 'spec.name');
  const theme = asOptionalString(spec.theme, 'spec.theme')?.trim();

  const tileSize = normalizePositiveInt(
    spec.tileSize,
    'spec.tileSize',
    defaultTileSize || 16,
  );

  const sheetObj = asOptionalRecord(spec.sheet, 'spec.sheet') ?? {};
  const columns = normalizePositiveInt(
    sheetObj.columns,
    'spec.sheet.columns',
    16,
  );
  const rows = normalizePositiveInt(sheetObj.rows, 'spec.sheet.rows', 16);

  const defaults = tilemapDefaultPaths(name);
  const outputObj = asOptionalRecord(spec.output, 'spec.output') ?? {};
  const sheetPngPath = normalizeResPath(
    asOptionalString(outputObj.sheetPngPath, 'spec.output.sheetPngPath') ??
      asOptionalString(
        outputObj.sheet_png_path,
        'spec.output.sheet_png_path',
      ) ??
      defaults.sheetPngPath,
  );
  const tilesetPath = normalizeResPath(
    asOptionalString(outputObj.tilesetPath, 'spec.output.tilesetPath') ??
      asOptionalString(outputObj.tileset_path, 'spec.output.tileset_path') ??
      defaults.tilesetPath,
  );
  const metaJsonPath = normalizeResPath(
    asOptionalString(outputObj.metaJsonPath, 'spec.output.metaJsonPath') ??
      asOptionalString(
        outputObj.meta_json_path,
        'spec.output.meta_json_path',
      ) ??
      defaults.metaJsonPath,
  );
  const asepriteJsonPath = normalizeResPath(
    asOptionalString(
      outputObj.asepriteJsonPath,
      'spec.output.asepriteJsonPath',
    ) ??
      asOptionalString(
        outputObj.aseprite_json_path,
        'spec.output.aseprite_json_path',
      ) ??
      defaults.asepriteJsonPath,
  );

  return {
    name,
    theme: theme && theme.length > 0 ? theme : undefined,
    tileSize,
    columns,
    rows,
    output: {
      name,
      theme: theme && theme.length > 0 ? theme : undefined,
      tileSize,
      sheet: { columns, rows },
      sheetPngPath,
      tilesetPath,
      metaJsonPath,
      asepriteJsonPath,
    },
  };
}

export function parseMapSize(
  value: unknown,
  fieldName: string,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const obj = asOptionalRecord(value, fieldName);
  if (!obj) return fallback;
  const width = normalizePositiveInt(
    (obj as Record<string, unknown>).width ??
      (obj as Record<string, unknown>).w,
    `${fieldName}.width`,
    fallback.width,
  );
  const height = normalizePositiveInt(
    (obj as Record<string, unknown>).height ??
      (obj as Record<string, unknown>).h,
    `${fieldName}.height`,
    fallback.height,
  );
  return { width, height };
}

export function parseWorldLayers(
  value: unknown,
): Array<{ name: string; type: string; zIndex: number }> {
  if (!Array.isArray(value)) {
    return [
      { name: 'Terrain', type: 'TileMapLayer', zIndex: 0 },
      { name: 'Deco', type: 'TileMapLayer', zIndex: 1 },
      { name: 'Props', type: 'TileMapLayer', zIndex: 2 },
    ];
  }

  const out: Array<{ name: string; type: string; zIndex: number }> = [];
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    const d = asRecord(raw, `spec.layers[${i}]`);
    const name = asNonEmptyString(d.name, `spec.layers[${i}].name`);
    const type = (
      asOptionalString(d.type, `spec.layers[${i}].type`) ?? 'TileMapLayer'
    ).trim();
    const zIndex = Math.floor(
      asOptionalNumber(
        d.zIndex ?? (d as Record<string, unknown>).z_index,
        `spec.layers[${i}].zIndex`,
      ) ?? 0,
    );
    out.push({ name, type, zIndex });
  }
  return out.length > 0
    ? out
    : [
        { name: 'Terrain', type: 'TileMapLayer', zIndex: 0 },
        { name: 'Deco', type: 'TileMapLayer', zIndex: 1 },
        { name: 'Props', type: 'TileMapLayer', zIndex: 2 },
      ];
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected array of strings`,
      valueType(value),
    );
  }
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new ValidationError(
        fieldName,
        `Invalid field "${fieldName}": expected array of strings`,
        valueType(raw),
      );
    }
    const trimmed = raw.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function parseBiomes(
  value: unknown,
  fieldName: string,
): PixelBiomeRule[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected array`,
      valueType(value),
    );
  }
  const out: PixelBiomeRule[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const biome = asRecord(value[i], `${fieldName}[${i}]`);
    const name = asNonEmptyString(biome.name, `${fieldName}[${i}].name`).trim();
    const weight = normalizeNonNegativeNumber(
      (biome as Record<string, unknown>).weight,
      `${fieldName}[${i}].weight`,
      0,
    );
    out.push({ name, weight });
  }
  return out;
}

function parsePlacementRules(
  value: unknown,
  fieldName: string,
): PixelPlacementRules | undefined {
  const rules = asOptionalRecord(value, fieldName);
  if (!rules) return undefined;

  const out: PixelPlacementRules = {};

  const riverCarve = pickFirstDefined(
    asOptionalBoolean(rules.riverCarve, `${fieldName}.riverCarve`),
    asOptionalBoolean(rules.river_carve, `${fieldName}.river_carve`),
  );
  if (riverCarve !== undefined) out.riverCarve = riverCarve;

  const riverWidth = pickFirstDefined(
    normalizeOptionalPositiveInt(rules.riverWidth, `${fieldName}.riverWidth`),
    normalizeOptionalPositiveInt(rules.river_width, `${fieldName}.river_width`),
  );
  if (riverWidth !== undefined) out.riverWidth = riverWidth;

  const riverFrequency = pickFirstDefined(
    normalizeOptionalNonNegativeNumber(
      rules.riverFrequency,
      `${fieldName}.riverFrequency`,
    ),
    normalizeOptionalNonNegativeNumber(
      rules.river_frequency,
      `${fieldName}.river_frequency`,
    ),
  );
  if (riverFrequency !== undefined) out.riverFrequency = riverFrequency;

  const riverMeander = pickFirstDefined(
    normalizeOptionalNonNegativeNumber(
      rules.riverMeander,
      `${fieldName}.riverMeander`,
    ),
    normalizeOptionalNonNegativeNumber(
      rules.river_meander,
      `${fieldName}.river_meander`,
    ),
  );
  if (riverMeander !== undefined) out.riverMeander = riverMeander;

  const noiseFrequency = pickFirstDefined(
    normalizeOptionalNonNegativeNumber(
      rules.noiseFrequency,
      `${fieldName}.noiseFrequency`,
    ),
    normalizeOptionalNonNegativeNumber(
      rules.noise_frequency,
      `${fieldName}.noise_frequency`,
    ),
  );
  if (noiseFrequency !== undefined) out.noiseFrequency = noiseFrequency;

  const noiseOctaves = pickFirstDefined(
    normalizeOptionalPositiveInt(
      rules.noiseOctaves,
      `${fieldName}.noiseOctaves`,
    ),
    normalizeOptionalPositiveInt(
      rules.noise_octaves,
      `${fieldName}.noise_octaves`,
    ),
  );
  if (noiseOctaves !== undefined) out.noiseOctaves = noiseOctaves;

  const noiseLacunarity = pickFirstDefined(
    normalizeOptionalNonNegativeNumber(
      rules.noiseLacunarity,
      `${fieldName}.noiseLacunarity`,
    ),
    normalizeOptionalNonNegativeNumber(
      rules.noise_lacunarity,
      `${fieldName}.noise_lacunarity`,
    ),
  );
  if (noiseLacunarity !== undefined) out.noiseLacunarity = noiseLacunarity;

  const noiseGain = pickFirstDefined(
    normalizeOptionalNonNegativeNumber(
      rules.noiseGain,
      `${fieldName}.noiseGain`,
    ),
    normalizeOptionalNonNegativeNumber(
      rules.noise_gain,
      `${fieldName}.noise_gain`,
    ),
  );
  if (noiseGain !== undefined) out.noiseGain = noiseGain;

  const sampleStep = pickFirstDefined(
    normalizeOptionalPositiveInt(rules.sampleStep, `${fieldName}.sampleStep`),
    normalizeOptionalPositiveInt(rules.sample_step, `${fieldName}.sample_step`),
  );
  if (sampleStep !== undefined) out.sampleStep = sampleStep;

  const smoothIterations = pickFirstDefined(
    normalizeOptionalNonNegativeInt(
      rules.smoothIterations,
      `${fieldName}.smoothIterations`,
    ),
    normalizeOptionalNonNegativeInt(
      rules.smooth_iterations,
      `${fieldName}.smooth_iterations`,
    ),
  );
  if (smoothIterations !== undefined) out.smoothIterations = smoothIterations;

  const pathsValue = pickFirstDefined(
    rules.paths,
    (rules as Record<string, unknown>).pathRules,
    (rules as Record<string, unknown>).path_rules,
  );
  if (pathsValue !== undefined) {
    const paths = asRecord(pathsValue, `${fieldName}.paths`);
    const parsed: PixelPathRules = {};
    const enabled = pickFirstDefined(
      asOptionalBoolean(paths.enabled, `${fieldName}.paths.enabled`),
      asOptionalBoolean(paths.isEnabled, `${fieldName}.paths.isEnabled`),
    );
    parsed.enabled = enabled ?? false;

    const width = pickFirstDefined(
      normalizeOptionalPositiveInt(paths.width, `${fieldName}.paths.width`),
      normalizeOptionalPositiveInt(
        (paths as Record<string, unknown>).pathWidth,
        `${fieldName}.paths.pathWidth`,
      ),
    );
    parsed.width = width ?? 2;

    const frequency = pickFirstDefined(
      normalizeOptionalNonNegativeNumber(
        (paths as Record<string, unknown>).frequency,
        `${fieldName}.paths.frequency`,
      ),
      normalizeOptionalNonNegativeNumber(
        (paths as Record<string, unknown>).noise_frequency,
        `${fieldName}.paths.noise_frequency`,
      ),
      normalizeOptionalNonNegativeNumber(
        (paths as Record<string, unknown>).noiseFrequency,
        `${fieldName}.paths.noiseFrequency`,
      ),
    );
    parsed.frequency = frequency ?? 0.05;

    const meander = pickFirstDefined(
      normalizeOptionalNonNegativeNumber(
        (paths as Record<string, unknown>).meander,
        `${fieldName}.paths.meander`,
      ),
    );
    parsed.meander = meander ?? 8.0;

    const searchRadius = pickFirstDefined(
      normalizeOptionalNonNegativeInt(
        (paths as Record<string, unknown>).searchRadius,
        `${fieldName}.paths.searchRadius`,
      ),
      normalizeOptionalNonNegativeInt(
        (paths as Record<string, unknown>).search_radius,
        `${fieldName}.paths.search_radius`,
      ),
    );
    parsed.searchRadius = searchRadius ?? 8;

    out.paths = parsed;
  }

  return out;
}

export function parseWorldSpecInput(
  spec: Record<string, unknown>,
): ParsedWorldSpecInput {
  const scenePath = normalizeResPath(
    asOptionalString(
      spec.scenePath ?? (spec as Record<string, unknown>).scene_path,
      'spec.scenePath',
    ) ?? 'res://scenes/generated/world/World.tscn',
  );

  const tilesetPathRaw = asOptionalString(
    spec.tilesetPath ?? (spec as Record<string, unknown>).tileset_path,
    'spec.tilesetPath',
  )?.trim();
  const tilesetPath =
    tilesetPathRaw && tilesetPathRaw.length > 0 ? tilesetPathRaw : undefined;

  const tilesetNameRaw = asOptionalString(
    spec.tilesetName ?? (spec as Record<string, unknown>).tileset_name,
    'spec.tilesetName',
  )?.trim();
  const tilesetName =
    tilesetNameRaw && tilesetNameRaw.length > 0 ? tilesetNameRaw : undefined;

  const mapSize = parseMapSize(
    spec.mapSize ?? (spec as Record<string, unknown>).map_size,
    'spec.mapSize',
    { width: 256, height: 256 },
  );

  const seedRaw = normalizeNonNegativeNumber(spec.seed, 'spec.seed', 12345);
  const seed = Math.floor(seedRaw);

  const layers = parseWorldLayers(spec.layers);

  const biomes = parseBiomes(spec.biomes, 'spec.biomes');

  const placementRules =
    parsePlacementRules(
      pickFirstDefined(
        (spec as Record<string, unknown>).placementRules,
        (spec as Record<string, unknown>).placement_rules,
      ),
      'spec.placementRules',
    ) ?? {};

  const organizeExisting =
    pickFirstDefined(
      asOptionalBoolean(
        (spec as Record<string, unknown>).organizeExisting,
        'spec.organizeExisting',
      ),
      asOptionalBoolean(
        (spec as Record<string, unknown>).organize_existing,
        'spec.organize_existing',
      ),
    ) ?? true;

  return {
    scenePath,
    tilesetPath,
    tilesetName,
    mapSize,
    seed,
    layers,
    biomes,
    placementRules,
    organizeExisting,
  };
}

export function parseRepresentation(
  value: unknown,
  fieldName: string,
): 'tile' | 'scene' {
  const raw = asOptionalString(value, fieldName)?.trim();
  if (!raw) return 'tile';
  if (raw === 'tile' || raw === 'scene') return raw;
  throw new ValidationError(
    fieldName,
    `Invalid field "${fieldName}": expected "tile" or "scene"`,
    valueType(value),
  );
}

export function parseSizePx(
  value: unknown,
  fieldName: string,
  fallback: { w: number; h: number },
): { w: number; h: number } {
  const sizeObj = asOptionalRecord(value, fieldName) ?? {};
  const w = normalizePositiveInt(
    (sizeObj as Record<string, unknown>).w ??
      (sizeObj as Record<string, unknown>).width,
    `${fieldName}.w`,
    fallback.w,
  );
  const h = normalizePositiveInt(
    (sizeObj as Record<string, unknown>).h ??
      (sizeObj as Record<string, unknown>).height,
    `${fieldName}.h`,
    fallback.h,
  );
  return { w, h };
}

export type ParsedObjectAnimationSpec = {
  enabled: boolean;
  defaultTag?: string;
  fps?: number;
  loop?: boolean;
};

export function parseObjectAnimationInput(
  value: unknown,
  fieldName: string,
): ParsedObjectAnimationSpec | null {
  const animation = asOptionalRecord(value, fieldName);
  if (!animation) return null;
  const enabled =
    asOptionalBoolean(
      (animation as Record<string, unknown>).enabled,
      `${fieldName}.enabled`,
    ) ?? false;
  if (!enabled) return null;

  const defaultTag = asOptionalString(
    pickFirstDefined(
      (animation as Record<string, unknown>).defaultTag,
      (animation as Record<string, unknown>).default_tag,
    ),
    `${fieldName}.defaultTag`,
  )?.trim();

  const fps = normalizeOptionalPositiveNumber(
    pickFirstDefined(
      (animation as Record<string, unknown>).fps,
      (animation as Record<string, unknown>).framesPerSecond,
      (animation as Record<string, unknown>).frames_per_second,
    ),
    `${fieldName}.fps`,
  );

  const loop = asOptionalBoolean(
    pickFirstDefined(
      (animation as Record<string, unknown>).loop,
      (animation as Record<string, unknown>).looped,
    ),
    `${fieldName}.loop`,
  );

  return {
    enabled,
    defaultTag: defaultTag && defaultTag.length > 0 ? defaultTag : undefined,
    fps,
    loop,
  };
}

export function parseObjectPlacementInput(
  value: unknown,
  fieldName: string,
): {
  density: number;
  onTiles: string[];
  avoidTiles: string[];
  preferNearTiles: string[];
  preferDistance: number;
  preferMultiplier: number;
  minDistance: number;
} {
  const placement = asOptionalRecord(value, fieldName) ?? {};
  const density = normalizeNonNegativeNumber(
    (placement as Record<string, unknown>).density,
    `${fieldName}.density`,
    0.1,
  );

  const onTiles = parseStringArray(
    pickFirstDefined(
      (placement as Record<string, unknown>).onTiles,
      (placement as Record<string, unknown>).on_tiles,
    ),
    `${fieldName}.onTiles`,
  );
  const avoidTiles = parseStringArray(
    pickFirstDefined(
      (placement as Record<string, unknown>).avoidTiles,
      (placement as Record<string, unknown>).avoid_tiles,
    ),
    `${fieldName}.avoidTiles`,
  );
  const preferNearTiles = parseStringArray(
    pickFirstDefined(
      (placement as Record<string, unknown>).preferNearTiles,
      (placement as Record<string, unknown>).prefer_near_tiles,
      (placement as Record<string, unknown>).nearTiles,
      (placement as Record<string, unknown>).near_tiles,
    ),
    `${fieldName}.preferNearTiles`,
  );

  const preferDistance =
    normalizeOptionalNonNegativeInt(
      pickFirstDefined(
        (placement as Record<string, unknown>).preferDistance,
        (placement as Record<string, unknown>).prefer_distance,
        (placement as Record<string, unknown>).preferNearDistance,
        (placement as Record<string, unknown>).prefer_near_distance,
        (placement as Record<string, unknown>).nearDistance,
        (placement as Record<string, unknown>).near_distance,
      ),
      `${fieldName}.preferDistance`,
    ) ?? 0;

  const preferMultiplier =
    normalizeOptionalNonNegativeNumber(
      pickFirstDefined(
        (placement as Record<string, unknown>).preferMultiplier,
        (placement as Record<string, unknown>).prefer_multiplier,
        (placement as Record<string, unknown>).preferNearMultiplier,
        (placement as Record<string, unknown>).prefer_near_multiplier,
      ),
      `${fieldName}.preferMultiplier`,
    ) ?? 1;

  const minDistance =
    normalizeOptionalNonNegativeInt(
      pickFirstDefined(
        (placement as Record<string, unknown>).minDistance,
        (placement as Record<string, unknown>).min_distance,
      ),
      `${fieldName}.minDistance`,
    ) ?? 0;

  return {
    density,
    onTiles,
    avoidTiles,
    preferNearTiles,
    preferDistance,
    preferMultiplier,
    minDistance,
  };
}

export function validateObjectSpecInput(
  spec: Record<string, unknown>,
  fieldName: string,
): void {
  const objectsValue = (spec as Record<string, unknown>).objects;
  if (!Array.isArray(objectsValue)) {
    throw new ValidationError(
      `${fieldName}.objects`,
      `Invalid field "${fieldName}.objects": expected array, got ${valueType(objectsValue)}`,
      valueType(objectsValue),
    );
  }

  for (let i = 0; i < objectsValue.length; i += 1) {
    const obj = asRecord(objectsValue[i], `${fieldName}.objects[${i}]`);
    void asNonEmptyString(
      (obj as Record<string, unknown>).id ??
        (obj as Record<string, unknown>).name,
      `${fieldName}.objects[${i}].id`,
    );
    void asOptionalString(
      (obj as Record<string, unknown>).kind,
      `${fieldName}.objects[${i}].kind`,
    );
    void parseRepresentation(
      (obj as Record<string, unknown>).representation,
      `${fieldName}.objects[${i}].representation`,
    );
    void parseSizePx(
      (obj as Record<string, unknown>).sizePx ??
        (obj as Record<string, unknown>).size_px,
      `${fieldName}.objects[${i}].sizePx`,
      { w: 32, h: 32 },
    );
    void asOptionalString(
      (obj as Record<string, unknown>).asepritePath ??
        (obj as Record<string, unknown>).sourceAsepritePath ??
        (obj as Record<string, unknown>).source_aseprite_path,
      `${fieldName}.objects[${i}].asepritePath`,
    );
    void parseObjectPlacementInput(
      (obj as Record<string, unknown>).placement,
      `${fieldName}.objects[${i}].placement`,
    );
    void parseObjectAnimationInput(
      (obj as Record<string, unknown>).animation,
      `${fieldName}.objects[${i}].animation`,
    );
  }
}
