# Tool Catalog (vNext baseline, 2026-01-03)

This is a human-readable catalog of high-level tools, focused on **LLM tool-calling stability**.

Principles:

- Prefer **manager tools** (action-dispatch) over single-purpose tools.
- Use **one canonical entrypoint** per category to avoid tool-choice flakiness.
- Treat non-manager tools as **legacy/advanced building blocks** unless a manager action is missing.

Legend:

- `[meta]` discovery/help tools (no project required unless stated)
- `[hybrid]` uses editor bridge when connected; otherwise headless when possible
- `[headless]` can run without editor bridge (may require `GODOT_PATH`)
- `[editor]` requires editor bridge
- `[external]` depends on external tools (ex: Aseprite; gated by safety flags)
- `[orchestrator]` runs a sequence of tool calls (workflow runner / macros)
- `[legacy]` kept for backwards compatibility (prefer managers)
- `[advanced]` low-level building block (prefer managers)

## Meta tools (preferred)

- `meta_tool_manager` `[meta]`
  - `server_info`
  - `tool_search`
  - `tool_help` (use `toolAction` to ask for help on a manager action)

Removed legacy meta tools (consolidated into `meta_tool_manager`):

- `server_info`
- `godot_tool_search`
- `godot_tool_help`

## Unified managers (preferred)

### Godot core

- `godot_workspace_manager` `[hybrid]`
  - `launch`, `connect`, `status`
  - `run`, `stop`, `restart`, `smoke_test`
  - `new_scene`, `open_scene`, `save_all`, `save_scene`
  - `get_state`
  - `guidelines.search`, `guidelines.get_section`
  - `docs.search`, `docs.get_class`
  - `doctor_report`

- `godot_scene_manager` `[hybrid]`
  - `create`, `update`, `batch_create`
  - `create_tilemap`, `create_ui`
  - `attach_script`, `attach_components`
  - `duplicate`, `reparent`, `instance`, `remove`, `undo`, `redo`

- `godot_inspector_manager` `[editor + headless fallback]`
  - `query`, `scene_tree.get`, `inspect`, `property_list`
  - `select`, `get_selection`
  - `connect_signal`, `disconnect_signal` (connect_signal supports headless fallback when `projectPath+scenePath` provided)
  - `set_property`, `get_property`
  - `method_list`, `signals.list`, `signals.connections.list`
  - `groups.get`, `groups.add`, `groups.remove`
  - `animation.list`, `animation.play`, `animation.stop`, `animation.seek`
  - `audio.play`, `audio.stop`, `audio.set_bus_volume`
  - `focus_node`, `shader.set_param`
  - `set_collision_layer`

- `godot_asset_manager` `[hybrid]`
  - `load_texture`
  - `get_uid`, `uid_convert`
  - `scan`, `reimport`, `auto_import_check`
  - `file_exists`, `create_folder`, `list_resources`, `search_files`
  - `scene.read`, `scene.delete`, `scene.duplicate`, `scene.rename`, `scene.replace_resource`

- `godot_project_config_manager` `[headless]`
  - `project_info.get`
  - `save_game_data`, `load_game_data`
  - `input_map.setup`
  - `project_setting.set`, `project_setting.get`
  - `errors.get_recent`

- `godot_log_manager` `[editor]`: `poll`, `tail`, `clear_output`
- `godot_editor_view_manager` `[editor]`: `capture_viewport`, `switch_screen`, `edit_script`, `add_breakpoint`, `list_open_scripts`, `panel.find`, `panel.read`

### Scaffolding / code

- `godot_builder_manager` `[hybrid]`
  - `lighting_preset`
  - `create_primitive`, `create_rigidbody`, `create_trigger_area`
  - `create_audio_player`
  - `spawn_fps_controller`
  - `create_health_bar_ui`
  - `spawn_spinning_pickup`
  - `create_particle_effect`
  - `generate_terrain_mesh`
  - `create_terrain_material`
  - `create_ui_template`
  - `set_anchor_preset`, `set_anchor_values`

- `godot_code_manager` `[hybrid]`
  - `script.create`, `script.read`, `script.attach`
  - `shader.create`, `shader.apply`
  - `file.edit`, `file.write_binary`

## Pipelines (preferred)

- `pixel_manager` `[headless]`
  - `project_analyze`
  - `goal_to_spec`
  - `tilemap_generate`, `world_generate`
  - `layer_ensure`
  - `object_generate`, `object_place`
  - `export_preview`
  - `smoke_test`
  - `macro_run`
  - `manifest_get`

- `aseprite_manager` `[external]`
  - `doctor`, `version`
  - `list_tags`, `list_layers`, `list_slices`
  - `export_sprite`, `export_sheet`, `export_sheets_by_tags`
  - `apply_palette_and_export`, `scale_and_export`, `convert_color_mode`
  - `export_sheet_and_reimport`, `export_sheets_by_tags_and_reimport`
  - `batch`

- `workflow_manager` `[orchestrator]`
  - `validate`, `run`
  - `macro.list`, `macro.describe`, `macro.manifest_get`
  - `macro.plan`, `macro.run`, `macro.resume`, `macro.validate`

## Lower-level building blocks (use only when needed)

Editor RPC (prefer unified managers):

- `godot_rpc` `[advanced]`: raw editor-bridge RPC calls
- `godot_inspect` `[advanced]`: safe class/object inspection (used by managers)
- `godot_editor_batch` `[advanced]`: atomic undoable batch of RPC calls
- (Connect) Use `godot_workspace_manager(action="connect")`

Headless primitives:

- `godot_headless_op`, `godot_headless_batch` `[headless]`

Legacy one-off project tools (prefer managers):

Project utilities (non-manager):

- `godot_preflight` `[headless]`
- `godot_sync_addon` `[headless]`
- `godot_import_project_assets` `[headless]`
- `list_projects` `[headless]`
- `create_scene` `[headless]`
- `get_debug_output`, `get_godot_version` `[headless]`

Removed legacy project tools (consolidated into managers):

- `launch_editor`, `run_project`, `stop_project`, `save_scene`
- `get_uid`, `load_sprite`, `get_project_info`, `add_node`

Removed legacy Aseprite tools (consolidated into `aseprite_manager`):

- `aseprite_doctor`, `aseprite_export_spritesheet`

Removed legacy Pixel building blocks (consolidated into `pixel_manager`):

- `pixel_*` tools (ex: `pixel_goal_to_spec`, `pixel_world_generate`, `pixel_object_place`)

## Migration mapping (removed tools → canonical entrypoints)

Use this table to avoid calling overlapping tools. Prefer the **canonical** tool/action.

| Legacy / duplicate tool       | Canonical tool/action                                             | Notes                                                                     |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `server_info`                 | `meta_tool_manager(action="server_info")`                         | Meta entrypoint                                                           |
| `godot_tool_search`           | `meta_tool_manager(action="tool_search")`                         | Meta entrypoint                                                           |
| `godot_tool_help`             | `meta_tool_manager(action="tool_help", tool=..., toolAction=...)` | Use `toolAction` to ask about manager actions                             |
| `aseprite_doctor`             | `aseprite_manager(action="doctor")`                               | External tools; gated by safety flags                                     |
| `aseprite_export_spritesheet` | `aseprite_manager(action="export_sheet")`                         | Output naming rules differ (`A_` enforced)                                |
| `pixel_*`                     | `pixel_manager(action="...")`                                     | Action name is the suffix (ex: `pixel_world_generate` → `world_generate`) |
| `launch_editor`               | `godot_workspace_manager(action="launch")`                        | Workspace entrypoint                                                      |
| `run_project`                 | `godot_workspace_manager(action="run")`                           | `mode="headless"` forces headless                                         |
| `stop_project`                | `godot_workspace_manager(action="stop")`                          | `mode="headless"` forces headless                                         |
| `save_scene`                  | `godot_workspace_manager(action="save_scene")`                    | Supports optional `newPath` for legacy compatibility                      |
| `add_node`                    | `godot_scene_manager(action="create")`                            | Scene edits                                                               |
| `load_sprite`                 | `godot_asset_manager(action="load_texture")`                      | Asset + scene apply                                                       |
| `get_uid`                     | `godot_asset_manager(action="get_uid")`                           | UID workflows                                                             |
| `get_project_info`            | `godot_project_config_manager(action="project_info.get")`         | Project metadata                                                          |
| `godot_connect_editor`        | `godot_workspace_manager(action="connect")`                       | Editor bridge connect                                                     |
| `godot_select_node`           | `godot_inspector_manager(action="select")`                        | Editor-only                                                               |
| `godot_scene_tree_query`      | `godot_inspector_manager(action="query")`                         | Editor-only                                                               |
| `godot_duplicate_node`        | `godot_scene_manager(action="duplicate")`                         | Editor-only                                                               |
| `godot_reparent_node`         | `godot_scene_manager(action="reparent")`                          | Editor-only                                                               |
| `godot_add_scene_instance`    | `godot_scene_manager(action="instance")`                          | Editor-only                                                               |
| `godot_disconnect_signal`     | `godot_inspector_manager(action="disconnect_signal")`             | Editor-only                                                               |
