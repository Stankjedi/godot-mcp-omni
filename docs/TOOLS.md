# Tools

This document is generated from the build-time tool definition modules.

- Source: `build/tools/definitions/*.js`
- Generator: `scripts/generate_tools_md.js`

Total tools: 51

---

## `add_node`

Add a node to an existing scene

| Field         | Value                                              |
| ------------- | -------------------------------------------------- |
| Required keys | `projectPath`, `scenePath`, `nodeType`, `nodeName` |
| Action enum   | —                                                  |

## `aseprite_doctor`

Check whether Aseprite CLI is available and report supported flags.

| Field         | Value |
| ------------- | ----- |
| Required keys | —     |
| Action enum   | —     |

## `aseprite_export_spritesheet`

Export an .aseprite file to a spritesheet PNG (and optional JSON) using Aseprite CLI.

| Field         | Value                                       |
| ------------- | ------------------------------------------- |
| Required keys | `projectPath`, `inputPath`, `outputPngPath` |
| Action enum   | —                                           |

## `aseprite_manager`

Unified Aseprite CLI tool (multi-action; safe path mapping to res://; enforces A\_ prefix for outputs).

| Field         | Value                                                                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                                                                                                                                                                                   |
| Action enum   | `doctor`, `version`, `list_tags`, `list_layers`, `list_slices`, `export_sprite`, `export_sheet`, `export_sheets_by_tags`, `apply_palette_and_export`, `scale_and_export`, `convert_color_mode`, `batch`, `export_sheet_and_reimport`, `export_sheets_by_tags_and_reimport` |

## `create_scene`

Create a new Godot scene file

| Field         | Value                      |
| ------------- | -------------------------- |
| Required keys | `projectPath`, `scenePath` |
| Action enum   | —                          |

## `get_debug_output`

Get the current debug output and errors

| Field         | Value |
| ------------- | ----- |
| Required keys | —     |
| Action enum   | —     |

## `get_godot_version`

Get the installed Godot version

| Field         | Value |
| ------------- | ----- |
| Required keys | —     |
| Action enum   | —     |

## `get_project_info`

Retrieve metadata about a Godot project

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `get_uid`

Get UID for a file (Godot 4.4+)

| Field         | Value                     |
| ------------- | ------------------------- |
| Required keys | `projectPath`, `filePath` |
| Action enum   | —                         |

## `godot_add_scene_instance`

Instance a PackedScene into the edited scene (undoable).

| Field         | Value       |
| ------------- | ----------- |
| Required keys | `scenePath` |
| Action enum   | —           |

## `godot_asset_manager`

Unified asset/resource tool (multi-action; combines UID, headless load_texture, and editor filesystem scan/reimport with headless import fallback).

| Field         | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| Required keys | `action`                                                           |
| Action enum   | `load_texture`, `get_uid`, `scan`, `reimport`, `auto_import_check` |

## `godot_connect_editor`

Connect to an in-editor bridge plugin (addons/godot_mcp_bridge) via TCP.

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `godot_disconnect_signal`

Disconnect a signal connection in the edited scene (undoable).

| Field         | Value                                            |
| ------------- | ------------------------------------------------ |
| Required keys | `fromNodePath`, `signal`, `toNodePath`, `method` |
| Action enum   | —                                                |

## `godot_duplicate_node`

Duplicate a node in the edited scene (undoable).

| Field         | Value      |
| ------------- | ---------- |
| Required keys | `nodePath` |
| Action enum   | —          |

## `godot_editor_batch`

Run multiple editor-bridge RPC calls as one undoable batch (atomic).

| Field         | Value   |
| ------------- | ------- |
| Required keys | `steps` |
| Action enum   | —       |

## `godot_editor_view_manager`

Unified editor UI tool (multi-action; requires editor bridge).

| Field         | Value                                                                |
| ------------- | -------------------------------------------------------------------- |
| Required keys | `action`                                                             |
| Action enum   | `capture_viewport`, `switch_screen`, `edit_script`, `add_breakpoint` |

## `godot_headless_batch`

Run multiple headless operations in one Godot process.

| Field         | Value                  |
| ------------- | ---------------------- |
| Required keys | `projectPath`, `steps` |
| Action enum   | —                      |

## `godot_headless_op`

Run a headless Godot operation (godot_operations.gd) inside a project.

| Field         | Value                      |
| ------------- | -------------------------- |
| Required keys | `projectPath`, `operation` |
| Action enum   | —                          |

## `godot_import_project_assets`

Run a headless import step for project assets (useful for SVG/UID workflows)

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `godot_inspect`

Reflection/introspection helpers over the editor bridge.

| Field         | Value        |
| ------------- | ------------ |
| Required keys | `query_json` |
| Action enum   | —            |

## `godot_inspector_manager`

Unified inspector/query tool (multi-action; uses editor bridge; connect_signal supports headless fallback when projectPath+scenePath provided).

| Field         | Value                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| Required keys | `action`                                                                             |
| Action enum   | `query`, `inspect`, `select`, `connect_signal`, `disconnect_signal`, `property_list` |

## `godot_log_manager`

Read/poll Godot editor logs for error-like lines (requires editor bridge).

| Field         | Value          |
| ------------- | -------------- |
| Required keys | `action`       |
| Action enum   | `poll`, `tail` |

## `godot_preflight`

Run lightweight environment checks for a Godot project (project file, addon, port, optional Godot path).

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `godot_reparent_node`

Reparent a node in the edited scene (undoable).

| Field         | Value                       |
| ------------- | --------------------------- |
| Required keys | `nodePath`, `newParentPath` |
| Action enum   | —                           |

## `godot_rpc`

Send an RPC request to the connected editor bridge.

| Field         | Value          |
| ------------- | -------------- |
| Required keys | `request_json` |
| Action enum   | —              |

## `godot_scene_manager`

Unified scene/node editing tool (multi-action; uses editor bridge when connected, otherwise headless when possible).

| Field         | Value                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                                                                               |
| Action enum   | `create`, `update`, `batch_create`, `create_tilemap`, `create_ui`, `attach_script`, `attach_components`, `duplicate`, `reparent`, `instance`, `remove`, `undo`, `redo` |

## `godot_scene_tree_query`

Query nodes in the edited scene by name/class/group (returns node paths + instance IDs + unique names).

| Field         | Value |
| ------------- | ----- |
| Required keys | —     |
| Action enum   | —     |

## `godot_select_node`

Select/focus a node in the editor scene tree.

| Field         | Value |
| ------------- | ----- |
| Required keys | —     |
| Action enum   | —     |

## `godot_sync_addon`

Sync the editor bridge addon into a Godot project and optionally enable the plugin

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `godot_workspace_manager`

Unified workspace tool (multi-action; launches/connects editor, runs/stops/restarts via editor when connected otherwise headless run_project).

| Field         | Value                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                         |
| Action enum   | `launch`, `connect`, `status`, `run`, `stop`, `smoke_test`, `open_scene`, `save_all`, `restart`, `doctor_report` |

## `launch_editor`

Launch Godot editor for a specific project

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `list_projects`

List Godot projects in a directory

| Field         | Value       |
| ------------- | ----------- |
| Required keys | `directory` |
| Action enum   | —           |

## `load_sprite`

Load a sprite into a Sprite2D node

| Field         | Value                                                 |
| ------------- | ----------------------------------------------------- |
| Required keys | `projectPath`, `scenePath`, `nodePath`, `texturePath` |
| Action enum   | —                                                     |

## `macro_manager`

Sequential automation macros for scaffolding game systems (reinforce plan) and optionally running the pixel pipeline via pixel_manager.

| Field         | Value                                                                                |
| ------------- | ------------------------------------------------------------------------------------ |
| Required keys | `action`                                                                             |
| Action enum   | `list_macros`, `describe_macro`, `plan`, `run`, `resume`, `manifest_get`, `validate` |

## `pixel_export_preview`

Export a lightweight PNG preview of a TileMapLayer (debug tile distribution image).

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `pixel_goal_to_spec`

Convert a natural-language goal to a validated pixel pipeline plan + derived specs (optional external HTTP adapter).

| Field         | Value                 |
| ------------- | --------------------- |
| Required keys | `projectPath`, `goal` |
| Action enum   | —                     |

## `pixel_layer_ensure`

Ensure a TileMapLayer-based world scene has the requested layer nodes (no tile generation).

| Field         | Value                 |
| ------------- | --------------------- |
| Required keys | `projectPath`, `spec` |
| Action enum   | —                     |

## `pixel_macro_run`

Run a multi-step pixel pipeline macro (tilemap -> world -> objects).

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `pixel_manager`

Unified wrapper for the 2D pixel pipeline tools (maps action -> pixel\_\*).

| Field         | Value                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`, `projectPath`                                                                                                                                                                 |
| Action enum   | `project_analyze`, `goal_to_spec`, `tilemap_generate`, `world_generate`, `layer_ensure`, `object_generate`, `object_place`, `export_preview`, `smoke_test`, `macro_run`, `manifest_get` |

## `pixel_manifest_get`

Get the latest pixel pipeline manifest for a project.

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `pixel_object_generate`

Generate pixel objects (sprites/scenes) for later placement.

| Field         | Value                 |
| ------------- | --------------------- |
| Required keys | `projectPath`, `spec` |
| Action enum   | —                     |

## `pixel_object_place`

Place generated objects into a world scene.

| Field         | Value                                   |
| ------------- | --------------------------------------- |
| Required keys | `projectPath`, `worldScenePath`, `spec` |
| Action enum   | —                                       |

## `pixel_project_analyze`

Analyze a Godot project for a 2D pixel pipeline profile.

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `pixel_smoke_test`

Run a short headless smoke test (run -> wait -> stop) and report error-like lines.

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `pixel_tilemap_generate`

Generate a pixel tile sheet + TileSet resource (optional external tools).

| Field         | Value                 |
| ------------- | --------------------- |
| Required keys | `projectPath`, `spec` |
| Action enum   | —                     |

## `pixel_world_generate`

Create/update a layered TileMapLayer-based world scene from a TileSet.

| Field         | Value                 |
| ------------- | --------------------- |
| Required keys | `projectPath`, `spec` |
| Action enum   | —                     |

## `run_project`

Run the Godot project and capture output

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `save_scene`

Save a scene (optionally as a new file)

| Field         | Value                      |
| ------------- | -------------------------- |
| Required keys | `projectPath`, `scenePath` |
| Action enum   | —                          |

## `server_info`

Return server metadata and safety defaults (CI-safe; no Godot required).

| Field         | Value |
| ------------- | ----- |
| Required keys | —     |
| Action enum   | —     |

## `stop_project`

Stop the currently running Godot project

| Field         | Value |
| ------------- | ----- |
| Required keys | —     |
| Action enum   | —     |

## `workflow_manager`

Validate or run a workflow (a sequential list of tool calls) inside the server process.

| Field         | Value             |
| ------------- | ----------------- |
| Required keys | `action`          |
| Action enum   | `validate`, `run` |
