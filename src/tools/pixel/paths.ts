export function normalizeResPath(p: string): string {
  const trimmed = p.trim();
  if (trimmed.startsWith('res://')) return trimmed;
  return `res://${trimmed.replace(/^[\\/]+/u, '')}`;
}

export function tilemapDefaultPaths(name: string) {
  const base = `res://assets/generated/tilesets/${name}/${name}`;
  return {
    sheetPngPath: `${base}.png`,
    tilesetPath: `${base}.tres`,
    metaJsonPath: `${base}.json`,
    asepriteJsonPath: `${base}.aseprite.json`,
  };
}

export function tilesetPathFromName(name: string): string {
  return `res://assets/generated/tilesets/${name}/${name}.tres`;
}

export function metaPathFromTilesetPath(tilesetPath: string): string {
  return tilesetPath.replace(/\.tres$/u, '.json');
}
