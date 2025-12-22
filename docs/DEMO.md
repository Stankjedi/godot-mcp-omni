# Demo (Editor RPC + Inspect)

Prereqs:

- Godot 4.x installed (`GODOT_PATH` set if auto-detect fails)
- In your target project, install the addon at `res://addons/godot_mcp_bridge/`
  - Recommended: `npm run sync:addon -- --project /abs/path/to/project` (or set `GODOT_PROJECT_PATH`)
- Enable the plugin once in the editor if needed: **Project → Project Settings → Plugins → “Godot MCP Bridge” → Enable**

See `../README.md` for the full Quickstart flow and environment variable table.

## Automated demo script

Run against an existing project:

```powershell
$env:GODOT_PATH = "C:\\Path\\To\\Godot_v4.x_win64_console.exe"
$env:DEMO_PROJECT_PATH = "C:\\Path\\To\\YourProject"
npm run demo:editor
```

If `DEMO_PROJECT_PATH` is not set, the script creates a temporary project and tries to enable the plugin via `project.godot` (may still require enabling once depending on your Godot version).

## Sample MCP tool requests (10)

These are the **tool argument payloads** you’d send via your MCP client.

1) Connect to editor

```json
{ "projectPath": "C:/Projects/MyGame", "timeoutMs": 60000 }
```

Tool: `godot_connect_editor`

2) Health / ping

```json
{ "request_json": { "method": "health", "params": {} } }
```

Tool: `godot_rpc`

3) Create a demo scene (headless)

```json
{ "projectPath": "C:/Projects/MyGame", "scenePath": ".godot_mcp/demo/Demo.tscn", "rootNodeType": "Node2D" }
```

Tool: `create_scene`

4) Open scene in editor

```json
{ "request_json": { "method": "open_scene", "params": { "path": "res://.godot_mcp/demo/Demo.tscn" } } }
```

Tool: `godot_rpc`

5) Begin a single undo step

```json
{ "request_json": { "method": "begin_action", "params": { "name": "demo:add+set" } } }
```

Tool: `godot_rpc`

6) Add a node (editor mutation)

```json
{ "request_json": { "method": "add_node", "params": { "parent_path": "root", "type": "Node2D", "name": "BatchNode", "props": { "unique_name_in_owner": true } } } }
```

Tool: `godot_rpc`

7) Set a property (editor mutation)

```json
{ "request_json": { "method": "set_property", "params": { "node_path": "root/BatchNode", "property": "visible", "value": false } } }
```

Tool: `godot_rpc`

8) Commit the undo step

```json
{ "request_json": { "method": "commit_action", "params": {} } }
```

Tool: `godot_rpc`

9) Editor filesystem wrappers

```json
{ "request_json": { "method": "filesystem.reimport_files", "params": { "files": ["res://.godot_mcp/demo/Demo.tscn"] } } }
```

Tool: `godot_rpc`

10) Inspect

Class:

```json
{ "query_json": { "class_name": "Node2D" } }
```

Object (supports node paths and unique names like `%BatchNode`):

```json
{ "query_json": { "node_path": "%BatchNode" } }
```

Tool: `godot_inspect`

## Troubleshooting editor connection

If `godot_connect_editor` fails, inspect the `details` block:
- `host`, `port`, `timeoutMs` to confirm the endpoint.
- `tokenSource` to verify where the token came from.
- `lockFileExists` to confirm the plugin has started inside the editor.
- `lastError.code` (e.g., `ECONNREFUSED`) for quick root-cause hints.

Typical fixes:
- Enable **Godot MCP Bridge** in Project Settings → Plugins.
- Ensure `GODOT_MCP_TOKEN` matches `.godot_mcp_token`.
- Allow the port through local firewall and wait for editor startup/imports.

## Undo verification

After steps 5–8, press **Ctrl/Cmd+Z once** in the editor: the node add + property change should revert together.
