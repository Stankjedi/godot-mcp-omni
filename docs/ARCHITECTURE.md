# Architecture

`godot-mcp-omni` is an MCP server that lets an AI drive Godot in two ways:

1) **Headless ops (fast / CI-friendly)** via `godot --headless --script ...` running `src/scripts/godot_operations.gd`.
2) **In-editor ops (full editor power)** via a Godot `EditorPlugin` addon that exposes a local TCP JSON-RPC bridge.

Related docs:

- Quickstart and environment variables: `../README.md`
- Demo flow and sample tool requests: `DEMO.md`
- Security model and audit logs: `SECURITY.md`

## Node/TypeScript Layout

- `src/index.ts` — CLI entrypoint (stdio MCP server).
- `src/server.ts` — MCP tool definitions + routing, standardized tool results.
- `src/godot_cli.ts` — Godot executable detection + command execution helpers.
- `src/headless_ops.ts` — wrapper for running `godot_operations.gd` and parsing its JSON output.
- `src/editor_bridge_client.ts` — TCP client for the editor bridge (newline-delimited JSON).
- `src/security.ts` — project-root allowlist checks, dangerous-op gating, audit logging.

## Headless Ops

`src/scripts/godot_operations.gd` is executed like:

`godot --headless --path <projectPath> --script godot_operations.gd <operation> <json_params>`

It prints **one JSON line** to stdout:

`{ "ok": true|false, "summary": "...", "details": { ... }, "logs": [ ... ] }`

## Editor Bridge

Addon path: `addons/godot_mcp_bridge/`

- `plugin.gd` starts the bridge server when enabled.
- `bridge_server.gd` runs a local TCP server (default `127.0.0.1:8765`) using newline-delimited JSON.
- `rpc_handlers.gd` implements editor operations + generic RPC + reflection.

Client flow:

1) Connect and send `{"type":"hello","token":"..."}`.
2) Receive `{"type":"hello_ok","capabilities":{...}}`.
3) Send requests `{"id":1,"method":"open_scene","params":{...}}` and receive `{"id":1,"ok":true,"result":{...}}`.
