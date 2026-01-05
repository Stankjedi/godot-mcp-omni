# `aseprite_manager` (Aseprite CLI Integration)

`aseprite_manager` wraps the **Aseprite CLI** in a safe, Godot-project-scoped tool.

Key principles:

- Aseprite is executed **CLI-only** (`--batch` / `-b`).
- `options.preview=true` runs Aseprite with `--preview` (**no disk changes**).
- All generated output filenames are forced to start with `A_` (no double-prefixing).
- All paths are restricted to the **Godot project root** (`project.godot` directory).

## Requirements

- Set `ALLOW_EXTERNAL_TOOLS=true`.
- Provide Aseprite via either:
  - `ASEPRITE_PATH` (directory or executable), or
  - Steam install auto-detection (Windows/WSL), or
  - `aseprite` available in `PATH`.

On Windows/WSL, Steam auto-detection uses `steamapps/libraryfolders.vdf` (when available) and common Steam install paths.

## Path rules (res:// mapping)

Inputs such as `inputFile`, `output.outputDir`, `palettes[]` accept:

- `res://...`
- Absolute OS paths
- Relative paths (resolved **relative to the project root**, never cwd)

`user://` paths are rejected.

The tool returns output file paths as:

- `pathAbs`: absolute OS path
- `resPath`: corresponding `res://...` path when inside the project root

## Output naming (`A_` prefix)

All output base names are normalized to:

- If the effective base name already starts with `A_` → unchanged
- Otherwise → `A_<base>`

Recommended suffixes used by this tool:

- Tag sheet: `A_<base>__tag_<tag>`
- Palette variant: `A_<base>__pal_<palette>`
- Scale: `A_<base>__x<scale>`
- Color mode: `A_<base>__cm_<mode>`

## Overwrite policy

- Default is `output.overwrite=false`.
- If an output would overwrite an existing file, the tool fails with `E_OUTPUT_EXISTS`.

## Actions (high level)

- Diagnostics: `doctor`, `version`
- Metadata: `list_tags`, `list_layers`, `list_slices`
- Exports: `export_sheet`, `export_sheets_by_tags`, `export_sprite`
- Transforms: `apply_palette_and_export`, `scale_and_export`, `convert_color_mode`
- Batch: `batch`
- Godot convenience:
  - `export_sheet_and_reimport`
  - `export_sheets_by_tags_and_reimport`

The `*_and_reimport` actions call `godot_asset_manager(action="auto_import_check")` after export.

## Examples

### Workflow example (recommended)

A ready-to-run workflow template is included:

- `scripts/workflow_aseprite_manager_example.json`

It runs:

- `tools/list` (sanity check)
- `aseprite_manager(action="doctor")`
- `aseprite_manager(action="list_tags")` against an input `.aseprite`
- `aseprite_manager(action="export_sheet")` with `options.preview=true` (no disk writes)

#### Run it

1. Edit the workflow and set `inputFile` to a real `.aseprite` file inside your project.
2. Ensure the prerequisites are set (`ALLOW_EXTERNAL_TOOLS=true` and Aseprite available via Steam auto-detection, `ASEPRITE_PATH`, or `aseprite` in `PATH`).
3. Run:

```bash
cd godot-mcp-omni
ALLOW_EXTERNAL_TOOLS=true \
  npm run workflow:run -- scripts/workflow_aseprite_manager_example.json --workflow-project /path/to/your-godot-project --ci-safe
```

Notes:

- The export step uses `options.preview=true` and will not create output directories or write files.
- To perform a real export, set `options.preview=false` and use a safe output directory like `res://art/export` (ensure it exists).

#### Troubleshooting

- If `doctor` reports external tools are disabled: set `ALLOW_EXTERNAL_TOOLS=true`.
- If `doctor` reports Aseprite not found: set `ASEPRITE_PATH` (directory or executable path) or add `aseprite` to `PATH`.
- If preview export fails due to missing directories: create the directory or change `output.outputDir` to an existing folder.

### Doctor

```json
{ "tool": "aseprite_manager", "args": { "action": "doctor" } }
```

### Export sheet + JSON

```json
{
  "tool": "aseprite_manager",
  "args": {
    "action": "export_sheet",
    "projectPath": "/abs/path/to/project",
    "inputFile": "res://art/characters/hero.aseprite",
    "output": { "outputDir": "res://art/export", "overwrite": false },
    "sheet": { "sheetType": "packed", "format": "json-array" }
  }
}
```

### Export sheets by tags + reimport

```json
{
  "tool": "aseprite_manager",
  "args": {
    "action": "export_sheets_by_tags_and_reimport",
    "projectPath": "/abs/path/to/project",
    "inputFile": "res://art/characters/hero.aseprite",
    "tags": "all",
    "output": { "outputDir": "res://art/export" },
    "sheet": { "sheetType": "packed", "format": "json-array" }
  }
}
```
