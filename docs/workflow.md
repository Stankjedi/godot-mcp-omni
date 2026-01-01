# Workflow quickstart

This project supports a simple JSON workflow format for running a sequential list of tool calls.

Related files:

- Schema: `scripts/workflow.schema.json`
- Minimal example: `scripts/workflow_example.json`
- Aseprite manager example: `scripts/workflow_aseprite_manager_example.json` (requires Aseprite + `ALLOW_EXTERNAL_TOOLS=true`)
- Runner script: `scripts/run_workflow.js`
- CLI runner: `godot-mcp-omni --run-workflow <path>`
- MCP tool: `workflow_manager` (see `docs/TOOLS.md`)

When installed via npm, the schema is shipped in the package at:

- `node_modules/godot-mcp-omni/scripts/workflow.schema.json`

## Workflow format (schemaVersion=1)

At a high level, a workflow JSON looks like this:

- `schemaVersion`: must be `1`
- `projectPath` (optional): a default project path used for `$PROJECT_PATH` substitution
- `steps`: an array of steps

Each step supports:

- `tool` (required): tool name, e.g. `tools/list`, `macro_manager`
- `args` (optional): object passed to the tool
- `id` / `title` (optional): metadata used by the runner
- `expectOk` (optional): defaults to `true`

## Validate a workflow (CI-safe, no Godot required)

You can validate a workflow via the `workflow_manager` tool using `action: "validate"`.
Validation is CI-safe and does not require a Godot binary or an editor connection.

One simple way is to use the MCP inspector:

```bash
cd godot-mcp-omni
npm run build
npm run inspector
```

Then call the tool:

```json
{
  "tool": "workflow_manager",
  "args": {
    "action": "validate",
    "workflowPath": "scripts/workflow_example.json"
  }
}
```

## Run a workflow locally (CI-safe)

The runner executes steps sequentially and prints step-by-step status:

```bash
cd godot-mcp-omni
npm run workflow:run -- --workflow scripts/workflow_example.json --ci-safe
```

You can also run the same workflow via the CLI entrypoint (useful for installed users):

```bash
cd godot-mcp-omni
npm run build
node build/index.js --run-workflow scripts/workflow_example.json --ci-safe
```

## `$PROJECT_PATH` substitution

If a step needs a project path, set the argument to the literal string `$PROJECT_PATH`:

```json
{
  "tool": "godot_preflight",
  "args": { "projectPath": "$PROJECT_PATH" }
}
```

Then provide a project path either by:

- Adding `"projectPath": "..."`
  at the workflow root, or
- Passing `--project <path>` to `scripts/run_workflow.js`
