# Tools

This document is generated from the build-time tool definition modules.

- Source: `build/tools/definitions/*.js`
- Generator: `scripts/generate_tools_md.js`

Total tools: 25

---

## `aseprite_manager`

Unified Aseprite CLI tool (multi-action; safe path mapping to res://; enforces A\_ prefix for outputs).

| Field         | Value                                                                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                                                                                                                                                                                   |
| Action enum   | `doctor`, `version`, `list_tags`, `list_layers`, `list_slices`, `export_sprite`, `export_sheet`, `export_sheets_by_tags`, `apply_palette_and_export`, `scale_and_export`, `convert_color_mode`, `export_sheet_and_reimport`, `export_sheets_by_tags_and_reimport`, `batch` |

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

## `godot_asset_manager`

Unified asset/resource tool (multi-action; combines UID, headless load_texture, and editor filesystem scan/reimport with headless import fallback).

| Field         | Value                                                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                                                                                                                                                       |
| Action enum   | `load_texture`, `get_uid`, `uid_convert`, `scan`, `reimport`, `auto_import_check`, `file_exists`, `create_folder`, `list_resources`, `search_files`, `scene.read`, `scene.delete`, `scene.duplicate`, `scene.rename`, `scene.replace_resource` |

## `godot_builder_manager`

High-level builder/preset tool (multi-action; composes existing manager tools to scaffold common nodes and UI patterns).

| Field         | Value                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Required keys | `action`                                                                                                                                                                                                                                                                                                                       |
| Action enum   | `lighting_preset`, `create_primitive`, `create_ui_template`, `create_audio_player`, `spawn_fps_controller`, `create_health_bar_ui`, `spawn_spinning_pickup`, `create_particle_effect`, `generate_terrain_mesh`, `create_terrain_material`, `create_trigger_area`, `create_rigidbody`, `set_anchor_preset`, `set_anchor_values` |

## `godot_code_manager`

Unified code/file tool (multi-action; safe project-root writes; script/shader helpers; supports editor attach via scene_manager).

| Field         | Value                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                                                       |
| Action enum   | `script.create`, `script.read`, `script.attach`, `gdscript.eval_restricted`, `shader.create`, `shader.apply`, `file.edit`, `file.write_binary` |

## `godot_editor_batch`

Run multiple editor-bridge RPC calls as one undoable batch (atomic).

| Field         | Value   |
| ------------- | ------- |
| Required keys | `steps` |
| Action enum   | —       |

## `godot_editor_view_manager`

Unified editor UI tool (multi-action; requires editor bridge).

| Field         | Value                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                              |
| Action enum   | `capture_viewport`, `switch_screen`, `edit_script`, `add_breakpoint`, `list_open_scripts`, `panel.find`, `panel.read` |

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

| Field         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Action enum   | `query`, `scene_tree.get`, `inspect`, `property_list`, `select`, `connect_signal`, `disconnect_signal`, `resource.add`, `set_property`, `get_property`, `get_selection`, `method_list`, `signals.list`, `signals.connections.list`, `groups.get`, `groups.add`, `groups.remove`, `animation.list`, `animation.play`, `animation.stop`, `animation.seek`, `animation.create_simple`, `audio.play`, `audio.stop`, `audio.set_bus_volume`, `focus_node`, `shader.set_param`, `set_collision_layer` |

## `godot_log_manager`

Read/poll Godot editor logs for error-like lines (requires editor bridge).

| Field         | Value                          |
| ------------- | ------------------------------ |
| Required keys | `action`                       |
| Action enum   | `poll`, `tail`, `clear_output` |

## `godot_preflight`

Run lightweight environment checks for a Godot project (project file, addon, port, optional Godot path).

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `godot_project_config_manager`

Project configuration manager (multi-action; wraps save/load, input map, and ProjectSettings access via headless ops when needed).

| Field         | Value                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                                                     |
| Action enum   | `project_info.get`, `save_game_data`, `load_game_data`, `input_map.setup`, `project_setting.set`, `project_setting.get`, `errors.get_recent` |

## `godot_rpc`

Send an RPC request to the connected editor bridge.

| Field         | Value          |
| ------------- | -------------- |
| Required keys | `request_json` |
| Action enum   | —              |

## `godot_scene_manager`

Unified scene/node editing tool (multi-action; uses editor bridge when connected, otherwise headless when possible).

| Field         | Value                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                                                                                                 |
| Action enum   | `create`, `update`, `batch_create`, `create_tilemap`, `create_ui`, `attach_script`, `attach_components`, `rename`, `move`, `duplicate`, `reparent`, `instance`, `remove`, `undo`, `redo` |

## `godot_sync_addon`

Sync the editor bridge addon into a Godot project and optionally enable the plugin

| Field         | Value         |
| ------------- | ------------- |
| Required keys | `projectPath` |
| Action enum   | —             |

## `godot_workspace_manager`

Unified workspace tool (multi-action; launches/connects editor, runs/stops/restarts via editor when connected, otherwise headless).

| Field         | Value                                                                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                                                                                                                                                 |
| Action enum   | `launch`, `connect`, `status`, `run`, `stop`, `smoke_test`, `new_scene`, `open_scene`, `save_scene`, `save_all`, `restart`, `get_state`, `guidelines.search`, `guidelines.get_section`, `docs.search`, `docs.get_class`, `doctor_report` |

## `list_projects`

List Godot projects in a directory

| Field         | Value       |
| ------------- | ----------- |
| Required keys | `directory` |
| Action enum   | —           |

## `meta_tool_manager`

Unified wrapper for MCP meta tools (server_info/tool_search/tool_help).

| Field         | Value                                     |
| ------------- | ----------------------------------------- |
| Required keys | `action`                                  |
| Action enum   | `server_info`, `tool_search`, `tool_help` |

## `pixel_manager`

Unified entrypoint for the 2D pixel pipeline (multi-action manager).

| Field         | Value                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required keys | `action`                                                                                                                                                                                |
| Action enum   | `project_analyze`, `goal_to_spec`, `tilemap_generate`, `world_generate`, `layer_ensure`, `object_generate`, `object_place`, `export_preview`, `smoke_test`, `macro_run`, `manifest_get` |

## `workflow_manager`

Validate or run a workflow (a sequential list of tool calls) inside the server process; also provides macro.\* actions for scaffolding workflows.

| Field         | Value                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Required keys | `action`                                                                                                                             |
| Action enum   | `validate`, `run`, `macro.list`, `macro.describe`, `macro.manifest_get`, `macro.plan`, `macro.run`, `macro.resume`, `macro.validate` |
