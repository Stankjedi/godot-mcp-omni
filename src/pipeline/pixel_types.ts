export type PixelProjectProfile = {
  projectPath: string;
  godotVersion: string;
  pixel: {
    tileSize: number;
    ppu: number;
    paletteHint: string;
    outlineStyle: string;
    lighting: string;
    camera: string;
  };
  paths: {
    assetsRoot: string;
    tilesetsRoot: string;
    spritesRoot: string;
    scenesRoot: string;
  };
  existing: {
    tilesets: string[];
    worldScenes: string[];
  };
  assumptions: string[];
  suggestions: string[];
  evidence?: Record<string, unknown>;
};

export type PixelPathRules = {
  enabled?: boolean;
  width?: number;
  frequency?: number;
  meander?: number;
  searchRadius?: number;
};

export type PixelPlacementRules = {
  riverCarve?: boolean;
  riverWidth?: number;
  riverFrequency?: number;
  riverMeander?: number;
  noiseFrequency?: number;
  noiseOctaves?: number;
  noiseLacunarity?: number;
  noiseGain?: number;
  sampleStep?: number;
  smoothIterations?: number;
  paths?: PixelPathRules;
};

export type PixelBiomeRule = {
  name: string;
  weight: number;
};

export type PixelTilemapSpec = {
  name: string;
  theme?: string;
  tileSize?: number;
  sheet?: { columns?: number; rows?: number };
  output?: {
    sheetPngPath?: string;
    tilesetPath?: string;
    metaJsonPath?: string;
    asepriteJsonPath?: string;
  };
  sourceAsepritePath?: string;
};

export type PixelWorldSpec = {
  scenePath?: string;
  tilesetPath?: string;
  tilesetName?: string;
  mapSize?: { width?: number; height?: number };
  seed?: number;
  layers?: Array<{ name: string; type?: string; zIndex?: number }>;
  biomes?: PixelBiomeRule[];
  placementRules?: PixelPlacementRules;
  organizeExisting?: boolean;
};

export type PixelObjectPlacement = {
  density?: number;
  onTiles?: string[];
  avoidTiles?: string[];
  preferNearTiles?: string[];
  preferDistance?: number;
  preferMultiplier?: number;
  minDistance?: number;
};

export type PixelObjectSpec = {
  id: string;
  name?: string;
  kind?: string;
  representation?: 'tile' | 'scene';
  sizePx?: { w?: number; h?: number; width?: number; height?: number };
  asepritePath?: string;
  placement?: PixelObjectPlacement;
};

export type PixelManifestStep = {
  name: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  summary: string;
  details?: Record<string, unknown>;
};

export type PixelManifest = {
  schemaVersion: 1;
  generatedAt: string;
  projectPath: string;
  seed?: number;
  profile?: PixelProjectProfile;
  steps: PixelManifestStep[];
  outputs: Record<string, unknown>;
};
