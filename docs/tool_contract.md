# Tool Contract (v1)

This document describes the **stable response shape** and **error semantics** used by `godot-mcp-omni` tools.

## Response envelope

All tools return a JSON object with:

- `ok: boolean` — success flag
- `summary: string` — short human-readable status (always present)
- `result: object | null` — normalized “primary result”
  - When `ok=true`, defaults to `details` when a tool does not set `result` explicitly
  - When `ok=false`, always `null`
- `error: { code, message, details?, retryable?, suggestedFix? } | null`
  - When `ok=true`, always `null`
  - When `ok=false`, always present (best-effort inference if a legacy tool didn’t set it)
- `meta: { tool, action, correlationId, durationMs }`

Legacy fields are kept for backwards compatibility and richer outputs:

- `details?: object`
- `logs?: string[]`
- `warnings?: string[]`
- `errors?: { code, message, details? }[]`
- `execution?: object`
- `files?: { kind, pathAbs, resPath, bytes? }[]`

## Correlation IDs

Every `CallTool` request is assigned a `correlationId`:

- Included in `meta.correlationId`
- Logged to `<project>/.godot_mcp/audit.log` when a `projectPath` can be resolved

## Error codes

Tools use these canonical error codes:

- `E_SCHEMA_VALIDATION` — missing/invalid arguments, unsupported action, mutually-exclusive params violated
- `E_NOT_CONNECTED` — editor-bridge required but not connected
- `E_NOT_FOUND` — referenced file/node/resource/section not found
- `E_PERMISSION_DENIED` — blocked by safety gates (`ALLOW_DANGEROUS_OPS`, `ALLOW_EXTERNAL_TOOLS`, etc.)
- `E_TIMEOUT` — operation timed out
- `E_UNSUPPORTED` — tool or capability not supported in current mode
- `E_INTERNAL` — unexpected internal failure

## Tool schema rules (inputSchema)

Multi-action “manager” tools use an `action`-dispatch pattern:

- `action` is required and constrained via `enum`
- `oneOf` branches enforce action-specific allowed parameters
- `additionalProperties: false` is applied to top-level tool input schemas wherever possible
