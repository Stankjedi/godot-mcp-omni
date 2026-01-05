import fs from 'fs/promises';
import path from 'path';

import { readPngSize } from './png.js';
import type { PixelProjectProfile } from './pixel_types.js';
import type { Dirent } from 'fs';

type WalkEntry = {
  absPath: string;
  relPath: string;
};

const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  '.github',
  '.vscode',
  '.idea',
  '.godot',
  '.import',
  '.mono',
  'node_modules',
  'build',
  'dist',
  'tmp',
  'temp',
]);

function normalizeRelToRes(relPath: string): string {
  const normalized = relPath.split(path.sep).join('/');
  return `res://${normalized}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function walkProjectFiles(
  projectPath: string,
  opts: { limit: number; logDebug?: (m: string) => void },
): Promise<WalkEntry[]> {
  const out: WalkEntry[] = [];

  const queue: Array<{ abs: string; rel: string }> = [
    { abs: projectPath, rel: '' },
  ];
  while (queue.length > 0) {
    const next = queue.pop();
    if (!next) continue;

    let dirEntries: Dirent[];
    try {
      dirEntries = await fs.readdir(next.abs, { withFileTypes: true });
    } catch (error) {
      opts.logDebug?.(`pixel analyzer: readdir failed: ${String(error)}`);
      continue;
    }

    for (const entry of dirEntries) {
      if (out.length >= opts.limit) return out;

      const relPath = next.rel ? path.join(next.rel, entry.name) : entry.name;
      const absPath = path.join(next.abs, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
        queue.push({ abs: absPath, rel: relPath });
        continue;
      }

      if (!entry.isFile()) continue;
      out.push({ absPath, relPath });
    }
  }

  return out;
}

async function sniffTextFilePrefix(
  absPath: string,
  maxBytes = 8192,
): Promise<string> {
  try {
    const fh = await fs.open(absPath, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}

async function readTextFile(
  absPath: string,
  maxBytes = 1024 * 256,
): Promise<string> {
  try {
    const fh = await fs.open(absPath, 'r');
    try {
      const st = await fh.stat();
      const size = Math.min(st.size, maxBytes);
      const buf = Buffer.alloc(size);
      const { bytesRead } = await fh.read(buf, 0, size, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}

async function detectGodotVersionFromProject(
  projectPath: string,
): Promise<string | null> {
  const projectGodotPath = path.join(projectPath, 'project.godot');
  const text = await readTextFile(projectGodotPath, 64 * 1024);
  if (!text) return null;

  // Godot 4 writes e.g.: config/features=PackedStringArray("4.5", "Forward Plus")
  const featuresLine = text
    .split(/\r?\n/u)
    .find((l) => l.includes('config/features='));
  if (featuresLine) {
    const match = featuresLine.match(/"(\d+\.\d+(?:\.\d+)?)"/u);
    if (match && match[1]) return match[1];
  }

  return null;
}

function detectTileSizeFromTilesetText(
  text: string,
): { tileSize: number; evidence: string } | null {
  if (!text) return null;
  const m =
    text.match(/tile_size\s*=\s*Vector2i\(\s*(\d+)\s*,\s*(\d+)\s*\)/u) ??
    text.match(/tile_size\s*=\s*Vector2\(\s*(\d+)\s*,\s*(\d+)\s*\)/u);
  if (!m) return null;
  const x = Number.parseInt(m[1] ?? '', 10);
  const y = Number.parseInt(m[2] ?? '', 10);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0)
    return null;
  if (x !== y) return null;
  return { tileSize: x, evidence: m[0] };
}

function inferLikelyTileSizeFromPngCandidates(
  candidates: Array<{ relPath: string; width: number; height: number }>,
): { tileSize: number; confidence: number; evidence: Record<string, unknown> } {
  const common = [8, 16, 24, 32, 48, 64];
  const counts = new Map<number, number>();

  for (const c of candidates) {
    for (const s of common) {
      if (c.width % s !== 0 || c.height % s !== 0) continue;
      // Prefer “tileset-like” images.
      const weight =
        c.relPath.includes('tileset') || c.relPath.includes('tiles') ? 2 : 1;
      counts.set(s, (counts.get(s) ?? 0) + weight);
    }
  }

  let best = 16;
  let bestCount = 0;
  for (const [size, count] of counts.entries()) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }

  const totalWeight = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  const confidence =
    totalWeight > 0 ? Math.min(1, bestCount / Math.max(1, totalWeight)) : 0;

  return {
    tileSize: best,
    confidence,
    evidence: {
      pngCandidates: candidates.slice(0, 10),
      counts: Object.fromEntries(
        Array.from(counts.entries()).sort((a, b) => b[1] - a[1]),
      ),
    },
  };
}

export async function analyzePixelProject(options: {
  projectPath: string;
  logDebug?: (m: string) => void;
  scanLimit?: number;
}): Promise<PixelProjectProfile> {
  const projectPath = options.projectPath;

  const assumptions: string[] = [];
  const suggestions: string[] = [];

  const assetsRootAbs = path.join(projectPath, 'assets');
  const scenesRootAbs = path.join(projectPath, 'scenes');
  const assetsRoot = (await pathExists(assetsRootAbs))
    ? 'res://assets'
    : 'res://';
  const scenesRoot = (await pathExists(scenesRootAbs))
    ? 'res://scenes'
    : 'res://';

  if (assetsRoot === 'res://') {
    assumptions.push('No assets/ directory found; using res:// as assetsRoot.');
    suggestions.push(
      'Create an assets/ folder (recommended: assets/generated/tilesets, assets/generated/sprites).',
    );
  }
  if (scenesRoot === 'res://') {
    assumptions.push('No scenes/ directory found; using res:// as scenesRoot.');
    suggestions.push(
      'Create a scenes/ folder (recommended: scenes/generated/world, scenes/generated/props).',
    );
  }

  const tilesetsRoot =
    assetsRoot === 'res://assets'
      ? 'res://assets/generated/tilesets'
      : 'res://generated/tilesets';
  const spritesRoot =
    assetsRoot === 'res://assets'
      ? 'res://assets/generated/sprites'
      : 'res://generated/sprites';

  const scanLimit = options.scanLimit ?? 2500;
  const files = await walkProjectFiles(projectPath, {
    limit: scanLimit,
    logDebug: options.logDebug,
  });

  const tilesetCandidates: string[] = [];
  const worldSceneCandidates: string[] = [];
  const pngCandidates: Array<{
    relPath: string;
    width: number;
    height: number;
  }> = [];

  for (const f of files) {
    const relLower = f.relPath.toLowerCase();

    if (relLower.endsWith('.tres') || relLower.endsWith('.res')) {
      const prefix = await sniffTextFilePrefix(f.absPath);
      if (
        prefix.includes('type="TileSet"') ||
        prefix.includes('type = "TileSet"')
      ) {
        tilesetCandidates.push(normalizeRelToRes(f.relPath));
      }
      continue;
    }

    if (relLower.endsWith('.tscn')) {
      // Simple heuristics: by location/name.
      const base = path.basename(relLower);
      if (
        relLower.includes('/world/') ||
        relLower.includes('\\world\\') ||
        base === 'world.tscn' ||
        base.includes('world')
      ) {
        worldSceneCandidates.push(normalizeRelToRes(f.relPath));
      }
      continue;
    }

    if (relLower.endsWith('.png')) {
      const looksTileset =
        relLower.includes('/tileset') ||
        relLower.includes('/tilesets/') ||
        relLower.includes('/tiles/') ||
        relLower.includes('tile');
      if (!looksTileset) continue;
      const size = await readPngSize(f.absPath);
      if (!size) continue;
      pngCandidates.push({
        relPath: f.relPath,
        width: size.width,
        height: size.height,
      });
    }
  }

  const godotVersion =
    (await detectGodotVersionFromProject(projectPath)) ?? 'unknown';
  if (godotVersion === 'unknown') {
    assumptions.push(
      'Godot version is unknown (project.godot config/features not detected).',
    );
  } else {
    assumptions.push(
      `Detected Godot version from project.godot: ${godotVersion}.`,
    );
  }

  const inferred = inferLikelyTileSizeFromPngCandidates(pngCandidates);
  let tileSizeFromTileset: {
    tileSize: number;
    evidence: string;
    tileset: string;
  } | null = null;
  for (const tilesetResPath of tilesetCandidates) {
    const rel = tilesetResPath.startsWith('res://')
      ? tilesetResPath.slice('res://'.length)
      : tilesetResPath;
    const abs = path.join(projectPath, rel.split('/').join(path.sep));
    const text = await readTextFile(abs, 256 * 1024);
    const detected = detectTileSizeFromTilesetText(text);
    if (!detected) continue;
    tileSizeFromTileset = {
      tileSize: detected.tileSize,
      evidence: detected.evidence,
      tileset: tilesetResPath,
    };
    break;
  }

  const tileSize =
    tileSizeFromTileset?.tileSize ??
    (inferred.confidence >= 0.25 ? inferred.tileSize : 16);
  if (tileSizeFromTileset) {
    assumptions.push(
      `Detected tileSize=${tileSizeFromTileset.tileSize} from TileSet (${tileSizeFromTileset.tileset}).`,
    );
  } else if (tileSize === 16 && inferred.confidence < 0.25) {
    assumptions.push('Defaulting tileSize=16 (insufficient evidence).');
  } else {
    assumptions.push(
      `Inferred tileSize=${tileSize} from tile sheet candidates (confidence=${inferred.confidence.toFixed(2)}).`,
    );
  }

  if (tilesetCandidates.length === 0) {
    suggestions.push(
      'No existing TileSet resources found; generate one via pixel_manager(action="tilemap_generate").',
    );
  }
  if (worldSceneCandidates.length === 0) {
    suggestions.push(
      'No existing world scenes detected; generate one via pixel_manager(action="world_generate").',
    );
  }
  if (files.length >= scanLimit) {
    assumptions.push(
      `Scan limit reached (${scanLimit} files); results may be incomplete.`,
    );
  }

  return {
    projectPath,
    godotVersion,
    pixel: {
      tileSize,
      ppu: tileSize,
      paletteHint: 'auto',
      outlineStyle: 'auto',
      lighting: 'auto',
      camera: 'topdown-orthographic',
    },
    paths: { assetsRoot, tilesetsRoot, spritesRoot, scenesRoot },
    existing: {
      tilesets: tilesetCandidates.slice(0, 50),
      worldScenes: worldSceneCandidates.slice(0, 50),
    },
    assumptions,
    suggestions,
    evidence: {
      ...inferred.evidence,
      ...(tileSizeFromTileset
        ? {
            tileSizeFromTileset: {
              tileset: tileSizeFromTileset.tileset,
              evidence: tileSizeFromTileset.evidence,
            },
          }
        : {}),
    },
  };
}
