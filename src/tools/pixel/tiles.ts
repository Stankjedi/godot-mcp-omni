type AtlasCoord = { x: number; y: number };

export function mappingFromMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const m = meta as Record<string, unknown>;
  const tiles = m.tiles;
  if (!tiles || typeof tiles !== 'object' || Array.isArray(tiles)) return {};
  const t = tiles as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(t)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const atlas = (raw as Record<string, unknown>).atlas;
    if (!atlas || typeof atlas !== 'object' || Array.isArray(atlas)) continue;
    const a = atlas as Record<string, unknown>;
    const x = typeof a.x === 'number' ? a.x : undefined;
    const y = typeof a.y === 'number' ? a.y : undefined;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    const coord = { x, y };
    out[key] = coord;

    const aliases = (raw as Record<string, unknown>).aliases;
    if (Array.isArray(aliases)) {
      for (const aliasRaw of aliases) {
        if (typeof aliasRaw !== 'string') continue;
        const alias = aliasRaw.trim();
        if (!alias) continue;
        if (out[alias] === undefined) out[alias] = coord;
        const lower = alias.toLowerCase();
        if (out[lower] === undefined) out[lower] = coord;
        const snake = lower.replace(/\s+/gu, '_');
        if (out[snake] === undefined) out[snake] = coord;
      }
    }
  }
  return out;
}

export function requiredTileMappingFallback(): Record<string, AtlasCoord> {
  return {
    grass: { x: 0, y: 0 },
    forest: { x: 1, y: 0 },
    water: { x: 2, y: 0 },
    path: { x: 3, y: 0 },
    cliff: { x: 4, y: 0 },
  };
}

export function tileAliases(): Record<string, string[]> {
  return {
    grass: ['grassland', 'ground', 'floor'],
    forest: ['forest_floor', 'trees', 'tree', 'woods'],
    water: ['river', 'lake'],
    path: ['road', 'trail'],
    cliff: ['rock', 'rocks', 'mountain'],
  };
}

function normalizeTileKeyFromName(rawName: string): string | null {
  const name = rawName.trim().toLowerCase().replace(/\s+/gu, '_');
  if (!name) return null;
  if (name === 'grass' || name === 'grassland' || name === 'ground')
    return 'grass';
  if (
    name === 'forest' ||
    name === 'forest_floor' ||
    name === 'forestground' ||
    name === 'tree' ||
    name === 'trees'
  )
    return 'forest';
  if (name === 'water' || name === 'river') return 'water';
  if (name === 'path' || name === 'road') return 'path';
  if (name === 'cliff' || name === 'rock' || name === 'rocks') return 'cliff';
  return null;
}

function atlasFromAsepriteBounds(
  boundsValue: unknown,
  tileSize: number,
): AtlasCoord | null {
  if (
    !boundsValue ||
    typeof boundsValue !== 'object' ||
    Array.isArray(boundsValue)
  )
    return null;
  const bounds = boundsValue as Record<string, unknown>;
  const x = typeof bounds.x === 'number' ? bounds.x : Number(bounds.x);
  const y = typeof bounds.y === 'number' ? bounds.y : Number(bounds.y);
  const w = typeof bounds.w === 'number' ? bounds.w : Number(bounds.w);
  const h = typeof bounds.h === 'number' ? bounds.h : Number(bounds.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  if (tileSize <= 0) return null;
  if (x < 0 || y < 0) return null;

  const ax = x / tileSize;
  const ay = y / tileSize;
  if (!Number.isInteger(ax) || !Number.isInteger(ay)) return null;

  // Only accept tile-aligned slices (best-effort).
  if (w < tileSize || h < tileSize) return null;
  return { x: ax, y: ay };
}

export function tileMappingFromAsepriteJson(
  json: unknown,
  tileSize: number,
): Record<string, AtlasCoord> | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const meta = root.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const slices = (meta as Record<string, unknown>).slices;
  if (!Array.isArray(slices)) return null;

  const mapping: Record<string, AtlasCoord> = {};
  for (const slice of slices) {
    if (!slice || typeof slice !== 'object' || Array.isArray(slice)) continue;
    const s = slice as Record<string, unknown>;
    const nameValue = s.name;
    if (typeof nameValue !== 'string') continue;
    const key = normalizeTileKeyFromName(nameValue);
    if (!key) continue;

    const keys = s.keys;
    if (!Array.isArray(keys) || keys.length === 0) continue;
    const firstKey = keys[0];
    if (!firstKey || typeof firstKey !== 'object' || Array.isArray(firstKey))
      continue;
    const bounds = (firstKey as Record<string, unknown>).bounds;
    const atlas = atlasFromAsepriteBounds(bounds, tileSize);
    if (!atlas) continue;
    mapping[key] = atlas;
  }

  return Object.keys(mapping).length > 0 ? mapping : null;
}

export function firstFrameRectFromAsepriteJson(json: unknown): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const frames = root.frames;

  const frameObjFromAny = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      const first = value[0];
      return first && typeof first === 'object' && !Array.isArray(first)
        ? (first as Record<string, unknown>)
        : null;
    }

    const rec = value as Record<string, unknown>;
    const firstKey = Object.keys(rec)[0];
    if (!firstKey) return null;
    const first = rec[firstKey];
    return first && typeof first === 'object' && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : null;
  };

  const first = frameObjFromAny(frames);
  if (!first) return null;
  const frame = first.frame;
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  const f = frame as Record<string, unknown>;
  const x = typeof f.x === 'number' ? f.x : Number(f.x);
  const y = typeof f.y === 'number' ? f.y : Number(f.y);
  const w = typeof f.w === 'number' ? f.w : Number(f.w);
  const h = typeof f.h === 'number' ? f.h : Number(f.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  return { x, y, w, h };
}

export type AsepriteFrameTag = {
  name: string;
  from: number;
  to: number;
  direction: string;
};

function frameCountFromAsepriteJson(json: unknown): number {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return 0;
  const root = json as Record<string, unknown>;
  const frames = root.frames;
  if (Array.isArray(frames)) return frames.length;
  if (frames && typeof frames === 'object' && !Array.isArray(frames))
    return Object.keys(frames as Record<string, unknown>).length;
  return 0;
}

export function frameTagsFromAsepriteJson(json: unknown): AsepriteFrameTag[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  const root = json as Record<string, unknown>;
  const meta = root.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  const frameTags = (meta as Record<string, unknown>).frameTags;
  if (!Array.isArray(frameTags)) return [];

  const frameCount = frameCountFromAsepriteJson(json);
  const out: AsepriteFrameTag[] = [];

  for (const rawTag of frameTags) {
    if (!rawTag || typeof rawTag !== 'object' || Array.isArray(rawTag))
      continue;
    const tag = rawTag as Record<string, unknown>;

    const name = typeof tag.name === 'string' ? tag.name.trim() : '';
    if (!name) continue;

    const fromRaw = typeof tag.from === 'number' ? tag.from : Number(tag.from);
    const toRaw = typeof tag.to === 'number' ? tag.to : Number(tag.to);
    if (![fromRaw, toRaw].every((n) => Number.isFinite(n))) continue;

    let from = Math.trunc(fromRaw);
    let to = Math.trunc(toRaw);
    if (frameCount > 0) {
      from = Math.max(0, Math.min(frameCount - 1, from));
      to = Math.max(0, Math.min(frameCount - 1, to));
    }
    if (from > to) [from, to] = [to, from];

    const direction =
      typeof tag.direction === 'string' && tag.direction.trim().length > 0
        ? tag.direction.trim()
        : 'forward';

    out.push({ name, from, to, direction });
  }

  return out;
}

function atlasCoordFromMappingValue(value: unknown): AtlasCoord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const x = typeof rec.x === 'number' ? rec.x : undefined;
  const y = typeof rec.y === 'number' ? rec.y : undefined;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  return { x, y };
}

export function atlasCoordFromTileName(
  name: string,
  mapping: Record<string, unknown>,
): AtlasCoord | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  const snake = lowered.replace(/\s+/gu, '_');

  const direct =
    atlasCoordFromMappingValue(mapping[trimmed]) ??
    atlasCoordFromMappingValue(mapping[lowered]) ??
    atlasCoordFromMappingValue(mapping[snake]);
  if (direct) return direct;

  const normalized = normalizeTileKeyFromName(trimmed);
  if (!normalized) return null;
  return atlasCoordFromMappingValue(mapping[normalized]);
}

export function defaultObjectAtlas(kind: string): AtlasCoord {
  const k = kind.trim().toLowerCase();
  if (k === 'rock') return { x: 0, y: 1 };
  if (k === 'tree') return { x: 1, y: 1 };
  if (k === 'building') return { x: 2, y: 1 };
  return { x: 3, y: 1 };
}
