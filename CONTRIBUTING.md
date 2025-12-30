# Contributing to godot-mcp-omni

Thanks for contributing! This repository is an MCP stdio server for Godot that supports both headless automation and optional in-editor control via a bridge plugin.

## Code of Conduct

Be respectful and collaborative. Assume good intent and keep discussions constructive.

## Development requirements

- Node.js 20+
- Godot 4.4+ (required only for integration tests and some end-to-end runs)

## Project layout (high level)

```
godot-mcp-omni/
├── src/                 # TypeScript sources (server + tools)
├── src/scripts/         # GDScript used by headless ops (copied into build/)
├── addons/              # Godot editor bridge plugin
├── scripts/             # Local tooling (build, docs generation, scenarios)
├── docs/                # Documentation (includes generated TOOLS.md)
├── test/                # Node test runner suites (*.test.mjs)
├── build/               # Compiled output (generated)
└── package.json         # Scripts and dependencies
```

## Local setup

From `godot-mcp-omni/`:

```bash
npm install
npm run build
```

For fast iteration:

```bash
npm run watch
```

## Verification commands (required for PRs)

Run these before opening a PR:

```bash
npm run lint
npm run format:check
npm test
```

Optional but recommended checks:

```bash
npm run verify:devplan
npm run verify:tools-doc
npm run verify:scenarios
npm run verify:full
```

## Godot integration tests

Some tests are skipped unless `GODOT_PATH` is set.

- Headless integration tests:
  - Set `GODOT_PATH` to a valid Godot executable path, then run `npm test`.
- One-click local runners (installs pinned Godot automatically when needed):
  - `npm run test:with-godot`
  - `npm run verify:scenarios:with-godot`
  - Note: the first run may download a large archive and cache it under `godot-mcp-omni/.cache/godot/`.
- Optional GUI capture test:
  - Set `GODOT_MCP_GUI_TEST=true` in addition to `GODOT_PATH`.

## Adding or changing MCP tools

This repo keeps tool definitions and implementations separated:

1. Add or update the tool definition modules under `src/tools/definitions/`.
2. Add or update the corresponding handler under `src/tools/` (or `src/tools/unified/` for unified managers).
3. Add tests under `test/`:
   - Prefer CI-safe tests by default (do not require Godot).
   - Gate Godot-dependent tests behind `GODOT_PATH`.
4. Regenerate tool docs and keep them up to date:

```bash
npm run docs:tools
npm run docs:tools -- --check
```

## Debugging

- Enable debug logs with `DEBUG=true`.
- Use the MCP inspector for interactive runs:

```bash
npm run inspector
```

## Cross-platform notes (Windows / WSL / Linux)

- Avoid hardcoded path separators; use Node’s `path` utilities.
- If you run via WSL, keep `GODOT_PATH` consistent with WSL paths (avoid mixing Windows + WSL paths in a single run).
