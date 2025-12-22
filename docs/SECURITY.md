# Security

This project is designed to let an AI modify Godot projects safely by default.

## Project Root Allowlist

Any operation that reads/writes project files validates that all file paths resolve **inside** the provided project root.

- Disallows `user://` paths
- Rejects paths that escape the project directory (including `..`-based escapes and absolute paths outside the project)
- Normalizes paths consistently across Windows/macOS/Linux before comparing

Implementation: `src/security.ts` (`resolveInsideProject`), enforced for headless ops and common editor RPCs.

## Dangerous Ops Gating

Operations considered destructive are blocked unless:

`ALLOW_DANGEROUS_OPS=true`

Examples of gated operations:

- export/build-like actions
- delete/move/rename-like actions
- project settings edits
- editor RPC access to `OS`, `ProjectSettings`, `FileAccess` via generic `call/set/get`

Implementation:

- Headless ops: `src/security.ts` (`assertDangerousOpsAllowed`) wired in `src/server.ts`
- Editor RPC: `src/security.ts` (`assertEditorRpcAllowed`) wired in `src/server.ts` (`handleGodotRpc`)

## Audit Log

For tool calls tied to a project (via `projectPath`, or an active editor connection), every request/response is appended to:

`<projectPath>/.godot_mcp/audit.log`

Tokens are redacted. The audit log also redacts common sensitive keys (passwords, secrets, API keys) to reduce accidental leakage. Do not store secrets in tool arguments.

### Rotation / size limits

To avoid unbounded log growth, the server rotates the audit log when it exceeds a size limit.

Environment variables:

- `GODOT_MCP_AUDIT_MAX_BYTES` (default: 5 MiB)
- `GODOT_MCP_AUDIT_BACKUPS` (default: 3, produces `audit.log.1`, `audit.log.2`, ...)

Implementation: `src/security.ts` (`appendAuditLog`, `redactSecrets`), wired in `src/server.ts`.

## Editor Bridge Authentication

The editor bridge requires a shared token:

- Server reads from env `GODOT_MCP_TOKEN` **or** `res://.godot_mcp_token`
- Client must send `{"type":"hello","token":"..."}` before any RPC calls

The bridge listens on `127.0.0.1` by default to avoid LAN exposure.

## Verification

Run a negative test that attempts to write outside the project root and confirms it is blocked:

`npm run verify:safety`
