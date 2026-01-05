# `workflow_manager` (`macro.*` actions)

`workflow_manager` provides **sequential automation** (“macros”) to scaffold common game systems into a Godot project via `macro.*` actions.

> Note: the old `macro_manager` tool was merged into `workflow_manager`.

This tool is designed to complement:

- Unified Managers (`godot_*_manager`) for interactive/editor-driven workflows
- Headless Ops (`godot_headless_op`, `godot_headless_batch`) for CI/headless automation
- Pixel Pipeline (`pixel_manager`) for 2D pixel content generation

## Safety

- By default, `workflow_manager` macro actions **do not overwrite existing outputs**.
- To overwrite existing files/scenes, you must set `ALLOW_DANGEROUS_OPS=true` and pass `forceRegenerate=true`.
- External tools are not used in the initial scaffold set.

## Actions

### `macro.list`

Lists available macro IDs.

```json
{ "tool": "workflow_manager", "args": { "action": "macro.list" } }
```

### `macro.describe`

Describes one macro and its expected outputs.

```json
{
  "tool": "workflow_manager",
  "args": {
    "action": "macro.describe",
    "projectPath": "/abs/path",
    "macroId": "input_system_scaffold"
  }
}
```

### `macro.plan`

Returns a plan of headless operations **without applying changes**.

```json
{
  "tool": "workflow_manager",
  "args": {
    "action": "macro.plan",
    "projectPath": "/abs/path",
    "macros": ["input_system_scaffold"]
  }
}
```

### `macro.run`

Executes one or more macros in order.

```json
{
  "tool": "workflow_manager",
  "args": {
    "action": "macro.run",
    "projectPath": "/abs/path",
    "macros": ["input_system_scaffold", "character_controller_2d_scaffold"],
    "validate": true
  }
}
```

- `dryRun=true`: returns the plan only (no changes)
- `validate=true`: validates any newly created scenes via `validate_scene`

#### Level pipeline + game systems (pixel_manager integration)

If you pass `pixel`, `workflow_manager` will call `pixel_manager(action="macro_run")` **before** running macros. This makes it possible to generate a pixel world scene (level pipeline) and scaffold game systems in a single call.

```json
{
  "tool": "workflow_manager",
  "args": {
    "action": "macro.run",
    "projectPath": "/abs/path",
    "pixel": {
      "goal": "tilemap + world + objects (size 64x64, forest/grass/river)",
      "seed": 42,
      "exportPreview": true,
      "smokeTest": true
    },
    "macros": [
      "input_system_scaffold",
      "character_controller_2d_scaffold",
      "camera_2d_scaffold",
      "ui_system_scaffold",
      "save_load_scaffold",
      "audio_system_scaffold"
    ],
    "composeMainScene": true,
    "validate": true
  }
}
```

- `composeMainScene=true` creates `res://scenes/generated/macro/Main.tscn` that instances the pixel world + generated player/camera (and HUD/PauseMenu when present).

### `macro.manifest_get`

Returns the most recent macro manifest (if present).

```json
{
  "tool": "workflow_manager",
  "args": { "action": "macro.manifest_get", "projectPath": "/abs/path" }
}
```

### `macro.validate`

Validates scenes by instantiating them (headless).

- If `scenes` is omitted, it uses `macro_manifest.json`’s created `.tscn` outputs.

```json
{
  "tool": "workflow_manager",
  "args": {
    "action": "macro.validate",
    "projectPath": "/abs/path",
    "scenes": ["res://scenes/generated/macro/player/Player.tscn"]
  }
}
```

### `macro.resume`

Resumes the most recent run by re-running macros that were not marked as `done` in the manifest.

## Outputs & Manifest

- Outputs are typically written under:
  - `res://scripts/macro/...`
  - `res://scenes/generated/macro/...`
- The latest run is recorded to:
  - `res://.godot_mcp/macro_manifest.json`
