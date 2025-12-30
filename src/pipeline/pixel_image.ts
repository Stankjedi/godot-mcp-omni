type Rgba = { r: number; g: number; b: number; a: number };

function clampByte(n: number): number {
  if (n <= 0) return 0;
  if (n >= 255) return 255;
  return n | 0;
}

function hash32(x: number): number {
  // xorshift-like integer hash
  let v = x | 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

function noise01(seed: number, x: number, y: number): number {
  const h = hash32(seed ^ hash32(x * 374761393) ^ hash32(y * 668265263));
  return (h & 0xffff) / 0xffff;
}

function tileBaseColor(tileX: number, tileY: number, seed: number): Rgba {
  if (tileY === 0 && tileX === 0) return { r: 60, g: 168, b: 75, a: 255 }; // grass
  if (tileY === 0 && tileX === 1) return { r: 40, g: 120, b: 55, a: 255 }; // forest
  if (tileY === 0 && tileX === 2) return { r: 40, g: 110, b: 220, a: 255 }; // water
  if (tileY === 0 && tileX === 3) return { r: 150, g: 105, b: 40, a: 255 }; // path
  if (tileY === 0 && tileX === 4) return { r: 140, g: 140, b: 140, a: 255 }; // cliff

  const idx = tileY * 1024 + tileX;
  const h = hash32(seed ^ idx);
  const r = 80 + (h & 0x7f);
  const g = 80 + ((h >>> 8) & 0x7f);
  const b = 80 + ((h >>> 16) & 0x7f);
  return { r, g, b, a: 255 };
}

export function generatePlaceholderTileSheetRgba(params: {
  tileSize: number;
  columns: number;
  rows: number;
  seed?: number;
}): { width: number; height: number; rgba: Uint8Array; meta: unknown } {
  const tileSize = Math.max(1, Math.floor(params.tileSize));
  const columns = Math.max(1, Math.floor(params.columns));
  const rows = Math.max(1, Math.floor(params.rows));
  const seed = params.seed ?? 1337;

  const width = columns * tileSize;
  const height = rows * tileSize;
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tileX = Math.floor(x / tileSize);
      const tileY = Math.floor(y / tileSize);
      const localX = x % tileSize;
      const localY = y % tileSize;

      const base = tileBaseColor(tileX, tileY, seed);
      const n = noise01(seed, x, y);
      let r = base.r;
      let g = base.g;
      let b = base.b;

      // Subtle noise.
      const jitter = Math.floor((n - 0.5) * 18);
      r += jitter;
      g += jitter;
      b += jitter;

      // Water highlight.
      if (tileY === 0 && tileX === 2) {
        if (localY < tileSize / 3) {
          r += 10;
          g += 20;
          b += 30;
        }
      }

      // Grid outline.
      if (
        localX === 0 ||
        localY === 0 ||
        localX === tileSize - 1 ||
        localY === tileSize - 1
      ) {
        r -= 35;
        g -= 35;
        b -= 35;
      }

      const i = (y * width + x) * 4;
      rgba[i] = clampByte(r);
      rgba[i + 1] = clampByte(g);
      rgba[i + 2] = clampByte(b);
      rgba[i + 3] = 255;
    }
  }

  const meta = {
    schemaVersion: 1,
    tileSize,
    sheet: { columns, rows },
    tiles: {
      grass: { atlas: { x: 0, y: 0 } },
      forest: { atlas: { x: 1, y: 0 } },
      water: { atlas: { x: 2, y: 0 } },
      path: { atlas: { x: 3, y: 0 } },
      cliff: { atlas: { x: 4, y: 0 } },
    },
  };

  return { width, height, rgba, meta };
}

export function generatePlaceholderSpriteRgba(params: {
  width: number;
  height: number;
  seed?: number;
}): { width: number; height: number; rgba: Uint8Array } {
  const width = Math.max(1, Math.floor(params.width));
  const height = Math.max(1, Math.floor(params.height));
  const seed = params.seed ?? 42;

  const rgba = new Uint8Array(width * height * 4);
  const h = hash32(seed);
  const base: Rgba = {
    r: 90 + (h & 0x7f),
    g: 90 + ((h >>> 8) & 0x7f),
    b: 90 + ((h >>> 16) & 0x7f),
    a: 255,
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const local = noise01(seed, x, y);
      let r = base.r + Math.floor((local - 0.5) * 12);
      let g = base.g + Math.floor((local - 0.5) * 12);
      let b = base.b + Math.floor((local - 0.5) * 12);

      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        r -= 40;
        g -= 40;
        b -= 40;
      }

      const i = (y * width + x) * 4;
      rgba[i] = clampByte(r);
      rgba[i + 1] = clampByte(g);
      rgba[i + 2] = clampByte(b);
      rgba[i + 3] = 255;
    }
  }

  return { width, height, rgba };
}
