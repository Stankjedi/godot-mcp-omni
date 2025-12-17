# Security

This project is designed to let an AI modify Godot projects safely by default.

## Project Root Allowlist

Tools that write files validate that all file paths resolve **inside** the provided `projectPath`.

Implementation: `src/security.ts` (`resolveInsideProject`).

## Dangerous Ops Gating

Operations considered destructive (delete/move/export/build/project_settings changes) are blocked unless:

`ALLOW_DANGEROUS_OPS=true`

Implementation: `src/security.ts` (`assertDangerousOpsAllowed`).

## Audit Log

For tool calls that include `projectPath`, every request/response is appended to:

`<projectPath>/.godot_mcp/audit.log`

Tokens are redacted.

Implementation: `src/security.ts` (`appendAuditLog`, `redactSecrets`), wired in `src/server.ts`.

## Editor Bridge Authentication

The editor bridge requires a shared token:

- Server reads from env `GODOT_MCP_TOKEN` **or** `res://.godot_mcp_token`
- Client must send `{"type":"hello","token":"..."}` before any RPC calls

The bridge listens on `127.0.0.1` by default to avoid LAN exposure.

