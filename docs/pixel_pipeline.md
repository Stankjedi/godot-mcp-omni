# Pixel Pipeline (2D)

This document describes the **2D pixel content pipeline** tools added to `godot-mcp-omni`.
For a quick overview and example, see `README.md` in the repo root.

Tip: `pixel_manager` provides a single entry point that maps `action` → `pixel_*` tools.

The goal is to support a “single request → assets + scenes generated” workflow:

- Tile sheet generation (builtin placeholder, or optional external image generation)
- TileSet creation (`.tres`) from an atlas
- TileMapLayer-based world scene creation (Godot 4.4+)
- Object sprite/scene generation and placement
- Macro orchestration + reproducible manifests

## Tools

### `pixel_project_analyze`

Analyzes a Godot project and returns a `PixelProjectProfile` with suggested defaults.

Inputs:

- `projectPath`

Outputs:

- A profile object (`tileSize`, asset roots, discovered candidates, assumptions).

### `pixel_goal_to_spec`

Converts a natural-language goal into a validated macro `plan[]` and derived specs
(`tilemapSpec`, `worldSpec`, `objectSpec`).

Inputs:

- `projectPath`
- `goal`
- `allowExternalTools` (optional; required for HTTP spec generation)
- `timeoutMs` (optional; default: 30000)

### `pixel_tilemap_generate`

Generates a tile sheet PNG and creates a Godot `TileSet` resource from it.

Inputs:

- `projectPath`
- `spec` (at least `spec.name`)
- Optional Aseprite source: `spec.sourceAsepritePath` (exports to the output sheet when enabled)
- `forceRegenerate` (requires `ALLOW_DANGEROUS_OPS=true`)
- `reuseExistingSheet` (optional: reuse an existing sheet PNG if present)
- `imageGenMode` (optional: set to `manual_drop` to require the tilesheet PNG to already exist; no placeholder generation)
- `allowExternalTools` (requires `ALLOW_EXTERNAL_TOOLS=true`)

Tip:

- If you export a custom tilesheet PNG (for example via `aseprite_export_spritesheet`) into the expected `spec.output.sheetPngPath`, run `pixel_tilemap_generate` with `reuseExistingSheet=true` to create the `.tres` without overwriting the PNG.
- For offline/manual workflows, you can set `imageGenMode="manual_drop"`: if the expected PNG is missing, the tool fails with `requiredFiles[]` and `suggestions[]` so you can drop the PNG and re-run.

Outputs:

- `res://assets/generated/tilesets/<name>/<name>.png`
- `res://assets/generated/tilesets/<name>/<name>.tres`
- `res://assets/generated/tilesets/<name>/<name>.json` metadata (tile mapping)
- `res://assets/generated/tilesets/<name>/<name>.aseprite.json` (when `spec.sourceAsepritePath` is used; raw Aseprite JSON export)

### `pixel_world_generate`

Creates/updates a layered world scene using **TileMapLayer nodes** (not deprecated `TileMap`).

Inputs:

- `projectPath`
- `spec.scenePath` (default: `res://scenes/generated/world/World.tscn`)
- `spec.tilesetPath` or `spec.tilesetName`
- `spec.mapSize` / `spec.seed` / biome rules

Outputs:

- World scene `.tscn` with a `World` root and layer nodes under `TileLayers/`.

### `pixel_layer_ensure`

Ensures a layered world scene has the requested `TileMapLayer` nodes (does not generate tiles).

Layer organization notes:

- If the scene already contains a `TileMapLayer` node with the same name (even outside `TileLayers/`),
  the operation reuses it and (by default) reparents it under `TileLayers/` to match the standard structure.
- Set `spec.organizeExisting=false` to disable reparenting.

### `pixel_object_generate`

Generates object sprite assets and (optionally) object scenes for interactive props.

Optional ManualDrop sprite input (no generation):

- `imageGenMode="manual_drop"`
- When `objects[].asepritePath` is omitted, the tool requires the expected sprite PNG to already exist.
- If the PNG is missing, the tool fails with `requiredFiles[]` and `suggestions[]` (CI-safe; fails before any Godot invocation).

Optional per-object Aseprite input:

- `spec.objects[].asepritePath` (requires `allowExternalTools=true` and `ALLOW_EXTERNAL_TOOLS=true`)
- When an Aseprite spritesheet is exported, the generated scene uses the **first frame** via `Sprite2D.region_*`.

Optional per-object animation (Aseprite `frameTags` → `SpriteFrames` + `AnimatedSprite2D`):

- `spec.objects[].animation.enabled=true` (only supported for `representation="scene"`)
- Requires a valid Aseprite JSON export containing `meta.frameTags` (generated when `asepritePath` export is used)
- Generates a `SpriteFrames` resource and assigns it to an `AnimatedSprite2D` node
- Default animation selection:
  - `animation.defaultTag` (when provided and found)
  - otherwise `idle` (when present)
  - otherwise the first frameTag

Default outputs:

- `res://assets/generated/sprites/<id>/<id>.png`
- `res://assets/generated/sprites/<id>/<id>.aseprite.json` (when `asepritePath` is used)
- `res://assets/generated/sprites/<id>/<id>.sprite_frames.tres` (when animation is enabled)
- `res://scenes/generated/props/<id>.tscn` (when `representation="scene"`)

### `pixel_object_place`

Places objects into a world scene:

- Tile-based props → `Props` `TileMapLayer`
- Scene instances → `Interactive` node

Placement rules supported (best-effort):

- `placement.onTiles` / `placement.avoidTiles` (tile name → atlas mapping from the tileset meta JSON)
- `placement.preferNearTiles` + `preferDistance` + `preferMultiplier` (e.g. “prefer near river” via `water` tiles)
- `placement.minDistance`

### `pixel_smoke_test`

Runs a short headless smoke test (run → wait → stop) and reports error-like log lines.

### `pixel_export_preview`

Exports a lightweight PNG preview of a TileMapLayer (debug tile distribution image).

### `pixel_macro_run`

Runs multiple steps (tilemap → world → objects) in order and records a manifest for
reproducible re-runs.

Macro runner notes:

- Builds a small **DAG** and runs steps in topological order (still single-threaded).
- Records per-step `cacheKey` and can skip steps on cache hits.
- Can append `pixel_export_preview` / `pixel_smoke_test` automatically when:
  - `exportPreview=true` / `smokeTest=true` is passed, or
  - the goal text contains keywords like “preview” / “smoke test”.
- When `SPEC_GEN_URL` is configured and `allowExternalTools=true`, the macro can use an
  external HTTP adapter to convert `goal` into a structured `plan[]` (validated).

### `pixel_manifest_get`

Loads the last recorded manifest (if present):

- `res://.godot_mcp/pixel_manifest.json`

## Spec fields and defaults

The pixel spec parser accepts both `camelCase` and `snake_case` field names.
Unknown fields are ignored (they do not cause errors).

### Tilemap spec (`pixel_tilemap_generate`)

- `name` (string, required)
- `theme` (string, optional)
- `tileSize` (positive integer, default: project profile tile size or 16)
- `sheet.columns` / `sheet.rows` (positive integers, default: 16)
- `output.sheetPngPath` / `output.tilesetPath` / `output.metaJsonPath` /
  `output.asepriteJsonPath` (string paths; default:
  `res://assets/generated/tilesets/<name>/<name>.*`)
- `sourceAsepritePath` (string, optional)

### World spec (`pixel_world_generate` / `pixel_layer_ensure`)

- `scenePath` (string, default: `res://scenes/generated/world/World.tscn`)
- `tilesetPath` or `tilesetName`
- `mapSize.width` / `mapSize.height` (positive integers, default: 256x256)
- `seed` (non-negative integer, default: 12345)
- `layers` (array of `{ name, type?, zIndex? }`, default:
  `Terrain`, `Deco`, `Props`)
- `biomes` (array of `{ name, weight }`, weights are non-negative;
  when omitted, the generator uses its internal grass/forest/river weights)
- `placementRules` (optional; when omitted, generator defaults apply):
  - `riverCarve` (boolean, default: derived from biome weights)
  - `riverWidth` (positive integer, default: derived from biome weights)
  - `riverFrequency` (non-negative number, default: 0.05)
  - `riverMeander` (non-negative number, default: 1.0)
  - `noiseFrequency` (non-negative number, default: 0.03)
  - `noiseOctaves` (positive integer, default: 3)
  - `noiseLacunarity` (non-negative number, default: 2.0)
  - `noiseGain` (non-negative number, default: 0.5)
  - `sampleStep` (positive integer, default: 4)
  - `smoothIterations` (non-negative integer, default: 1)
  - `paths`:
    - `enabled` (boolean, default: false)
    - `width` (positive integer, default: 2)
    - `frequency` (non-negative number, default: 0.05)
    - `meander` (non-negative number, default: 8.0)
    - `searchRadius` (non-negative integer, default: 8)

### Object spec (`pixel_object_generate` / `pixel_object_place`)

Each entry in `objects[]` supports:

- `id` (string, required)
- `kind` (string, optional; default: `object`)
- `representation` (`tile` or `scene`, default: `tile`)
- `sizePx.w` / `sizePx.h` (positive integers, default: 32x32)
- `asepritePath` (string, optional; requires external tools)
- `animation` (object, optional; requires Aseprite JSON export with `frameTags`):
  - `enabled` (boolean; must be `true` to enable animation generation)
  - `defaultTag` (string, optional; preferred default animation name)
  - `fps` (positive number, optional; default: 8)
  - `loop` (boolean, optional; default: true; applied to all generated animations)
- `placement` (used by `pixel_object_place`):
  - `density` (non-negative number, default: 0.1)
  - `onTiles` / `avoidTiles` / `preferNearTiles` (arrays of strings)
  - `preferDistance` (non-negative integer, default: 0)
  - `preferMultiplier` (non-negative number, default: 1)
  - `minDistance` (non-negative integer, default: 0)

## Aseprite tools (optional)

These tools require `ALLOW_EXTERNAL_TOOLS=true`. They are not required for the pixel pipeline to work.

### `aseprite_doctor`

Reports whether Aseprite can be found and (when enabled) which CLI flags appear supported.

### `aseprite_export_spritesheet`

Exports an `.aseprite` file to a spritesheet PNG (and optional JSON) inside the project:

- `inputPath`: `.aseprite` file path
- `outputPngPath`: output PNG path
- `outputJsonPath` (optional): output JSON path

## Environment variables

### External tools

External tools are disabled by default.

- `ALLOW_EXTERNAL_TOOLS=true` enables external tool execution.
- `ASEPRITE_PATH=/abs/path/to/aseprite` enables the Aseprite runner (when used).
  - You can point to either the **executable** or the **install directory**.
  - Steam default (Windows): `C:\Program Files (x86)\Steam\steamapps\common\Aseprite`
  - WSL path for the same install: `/mnt/c/Program Files (x86)/Steam/steamapps/common/Aseprite`

### External image generation (optional)

If `allowExternalTools=true` is passed to a tool, and `ALLOW_EXTERNAL_TOOLS=true` is set,
`pixel_tilemap_generate` can call an HTTP image generator:

## ManualDrop mode (opt-in)

ManualDrop is an **offline-friendly** mode that skips all image generation and instead requires
the expected PNG files to already exist inside the project.

Behavior:

- If the PNG exists: the tool proceeds without writing the file.
- If the PNG does not exist: the tool returns `ok:false` with:
  - `details.requiredFiles[]` (expected `res://...` paths)
  - `details.expectedSizePx` (expected dimensions)
  - `details.suggestions[]` (next actions)

Supported tools:

- `pixel_tilemap_generate` (`imageGenMode="manual_drop"` for the tilesheet PNG)
- `pixel_object_generate` (`imageGenMode="manual_drop"` for per-object sprite PNGs when `asepritePath` is omitted)

- `IMAGE_GEN_URL=https://...` (POST JSON → returns PNG body)
- Optional auth:
  - `IMAGE_GEN_AUTH_HEADER=Authorization`
  - `IMAGE_GEN_AUTH_VALUE=Bearer <token>`

If not configured, the pipeline falls back to a **builtin placeholder generator**.

### External spec generation (optional)

If `allowExternalTools=true` is passed and `ALLOW_EXTERNAL_TOOLS=true` is set,
`pixel_goal_to_spec` (and `pixel_macro_run` when given `goal`) can call an HTTP spec generator:

- `SPEC_GEN_URL=https://...` (POST JSON → returns JSON object)
- Optional auth:
  - `SPEC_GEN_AUTH_HEADER=Authorization`
  - `SPEC_GEN_AUTH_VALUE=Bearer <token>`

`pixel_macro_run` also supports:

- `specGenTimeoutMs` (default: 30000)

### Overwrites

- `ALLOW_DANGEROUS_OPS=true` is required to overwrite existing generated assets when
  `forceRegenerate=true`.

## Manifest

The pipeline writes a reproducibility manifest (paths, seed, inputs, versions) to:

- `res://.godot_mcp/pixel_manifest.json`
