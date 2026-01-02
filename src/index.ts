#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

type CliMode =
  | 'server'
  | 'doctor'
  | 'listTools'
  | 'listToolsJson'
  | 'printMcpConfig'
  | 'runScenarios'
  | 'runWorkflow';

type ParsedArgs = {
  showHelp: boolean;
  showVersion: boolean;
  mode: CliMode;
  doctorReadOnly: boolean;
  json: boolean;
  projectPath?: string;
  runWorkflowPath?: string;
  workflowProjectPath?: string;
  godotPath?: string;
  strictPathValidation: boolean;
  ciSafe: boolean;
  debug: boolean;
};

function usage() {
  return [
    'godot-mcp-omni (MCP stdio server for Godot)',
    '',
    'Usage:',
    '  godot-mcp-omni [options]',
    '  node build/index.js [options]',
    '',
    'Options:',
    '  --help                      Show this help and exit',
    '  --version                   Print version and exit',
    '  --doctor                    Run environment/project checks and exit',
    '  --doctor-readonly           With --doctor: do not modify project files',
    '  --json                      Print doctor results as JSON (doctor-only)',
    '  --project <path>            Project path for --doctor checks (optional)',
    '  --run-scenarios             Run the CI-safe scenario suite and exit',
    '  --run-workflow <path>       Run a workflow JSON and exit',
    '  --workflow-project <path>   Override $PROJECT_PATH for --run-workflow',
    '  --ci-safe                   Workflow/scenarios: force GODOT_PATH=""',
    '  --godot-path <path>         Override Godot executable path',
    '  --strict-path-validation    Enable strict Godot path validation',
    '  --debug                     Enable debug logs (sets DEBUG=true)',
    '  --print-mcp-config          Print MCP server config JSON and exit',
    '  --list-tools                Print available MCP tools and exit',
    '  --list-tools-json           Print available MCP tools as JSON and exit',
    '',
    'Notes:',
    '  - Without options, the server starts and communicates over stdin/stdout.',
    '  - You can also configure GODOT_PATH via environment variables.',
  ].join('\n');
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let showHelp = false;
  let showVersion = false;
  let doctor = false;
  let listTools = false;
  let listToolsJson = false;
  let doctorReadOnly = false;
  let json = false;
  let printMcpConfig = false;
  let projectPath: string | undefined;
  let runScenarios = false;
  let runWorkflowPath: string | undefined;
  let workflowProjectPath: string | undefined;
  let godotPath: string | undefined;
  let strictPathValidation = false;
  let ciSafe = false;
  let debug = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      showHelp = true;
      continue;
    }
    if (a === '--version') {
      showVersion = true;
      continue;
    }
    if (a === '--doctor') {
      doctor = true;
      continue;
    }
    if (a === '--doctor-readonly') {
      doctorReadOnly = true;
      continue;
    }
    if (a === '--json') {
      json = true;
      continue;
    }
    if (a === '--debug') {
      debug = true;
      continue;
    }
    if (a === '--print-mcp-config') {
      printMcpConfig = true;
      continue;
    }
    if (a === '--list-tools') {
      listTools = true;
      continue;
    }
    if (a === '--list-tools-json') {
      listToolsJson = true;
      continue;
    }
    if (a === '--strict-path-validation') {
      strictPathValidation = true;
      continue;
    }
    if (a === '--ci-safe') {
      ciSafe = true;
      continue;
    }
    if (a === '--godot-path') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --godot-path\n\n${usage()}`);
      }
      godotPath = value;
      i += 1;
      continue;
    }
    if (a === '--run-workflow') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --run-workflow\n\n${usage()}`);
      }
      runWorkflowPath = value;
      i += 1;
      continue;
    }
    if (a === '--workflow-project') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --workflow-project\n\n${usage()}`);
      }
      workflowProjectPath = value;
      i += 1;
      continue;
    }
    if (a === '--project') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --project\n\n${usage()}`);
      }
      projectPath = value;
      i += 1;
      continue;
    }
    if (a === '--run-scenarios') {
      runScenarios = true;
      continue;
    }

    throw new Error(`Unknown argument: ${a}\n\n${usage()}`);
  }

  if (!showHelp && !showVersion) {
    if (
      doctorReadOnly &&
      (!doctor ||
        listTools ||
        listToolsJson ||
        printMcpConfig ||
        runScenarios ||
        runWorkflowPath ||
        workflowProjectPath ||
        ciSafe)
    ) {
      throw new Error(
        `--doctor-readonly is only supported with --doctor (and optional --json/--project/--godot-path/--strict-path-validation/--debug)\n\n${usage()}`,
      );
    }

    if (listToolsJson) {
      if (
        listTools ||
        doctor ||
        doctorReadOnly ||
        json ||
        printMcpConfig ||
        projectPath ||
        runScenarios ||
        runWorkflowPath ||
        workflowProjectPath ||
        ciSafe ||
        godotPath ||
        strictPathValidation ||
        debug
      ) {
        throw new Error(
          `--list-tools-json cannot be combined with ` +
            `--list-tools/--doctor/--json/--print-mcp-config/--project/--run-scenarios/--run-workflow/--workflow-project/--ci-safe/--godot-path/--strict-path-validation/--debug\n\n${usage()}`,
        );
      }

      return {
        showHelp,
        showVersion,
        mode: 'listToolsJson',
        doctorReadOnly,
        json,
        projectPath,
        runWorkflowPath,
        workflowProjectPath,
        godotPath,
        strictPathValidation,
        ciSafe,
        debug,
      };
    }

    if (listTools) {
      if (
        doctor ||
        doctorReadOnly ||
        listToolsJson ||
        json ||
        printMcpConfig ||
        projectPath ||
        runScenarios ||
        runWorkflowPath ||
        workflowProjectPath ||
        ciSafe ||
        godotPath ||
        strictPathValidation
      ) {
        throw new Error(
          `--list-tools cannot be combined with ` +
            `--doctor/--json/--print-mcp-config/--project/--run-scenarios/--run-workflow/--workflow-project/--ci-safe/--godot-path/--strict-path-validation\n\n${usage()}`,
        );
      }

      return {
        showHelp,
        showVersion,
        mode: 'listTools',
        doctorReadOnly,
        json,
        projectPath,
        runWorkflowPath,
        workflowProjectPath,
        godotPath,
        strictPathValidation,
        ciSafe,
        debug,
      };
    }

    if (printMcpConfig) {
      if (doctor || runScenarios || runWorkflowPath) {
        throw new Error(
          `--print-mcp-config cannot be combined with ` +
            `--doctor/--run-scenarios/--run-workflow\n\n${usage()}`,
        );
      }

      return {
        showHelp,
        showVersion,
        mode: 'printMcpConfig',
        doctorReadOnly,
        json,
        projectPath,
        runWorkflowPath,
        workflowProjectPath,
        godotPath,
        strictPathValidation,
        ciSafe,
        debug,
      };
    }

    if (projectPath && !doctor) {
      throw new Error(`--project is only supported with --doctor\n\n${usage()}`);
    }

    if (ciSafe && !runWorkflowPath && !runScenarios) {
      throw new Error(
        `--ci-safe is only supported with --run-workflow or --run-scenarios\n\n${usage()}`,
      );
    }

    if (workflowProjectPath && !runWorkflowPath) {
      throw new Error(
        `--workflow-project is only supported with --run-workflow\n\n${usage()}`,
      );
    }

    if (json && !doctor) {
      throw new Error(`--json is only supported with --doctor\n\n${usage()}`);
    }

    if (runScenarios) {
      if (doctor || json || printMcpConfig || runWorkflowPath) {
        throw new Error(
          `--run-scenarios cannot be combined with --doctor/--json/--print-mcp-config/--run-workflow\n\n${usage()}`,
        );
      }

      return {
        showHelp,
        showVersion,
        mode: 'runScenarios',
        doctorReadOnly,
        json,
        projectPath,
        runWorkflowPath,
        workflowProjectPath,
        godotPath,
        strictPathValidation,
        ciSafe,
        debug,
      };
    }

    if (runWorkflowPath) {
      if (doctor || json || printMcpConfig) {
        throw new Error(
          `--run-workflow cannot be combined with --doctor/--json/--print-mcp-config\n\n${usage()}`,
        );
      }

      return {
        showHelp,
        showVersion,
        mode: 'runWorkflow',
        doctorReadOnly,
        json,
        projectPath,
        runWorkflowPath,
        workflowProjectPath,
        godotPath,
        strictPathValidation,
        ciSafe,
        debug,
      };
    }

    if (doctor) {
      return {
        showHelp,
        showVersion,
        mode: 'doctor',
        doctorReadOnly,
        json,
        projectPath,
        runWorkflowPath,
        workflowProjectPath,
        godotPath,
        strictPathValidation,
        ciSafe,
        debug,
      };
    }
  }

  return {
    showHelp,
    showVersion,
    doctorReadOnly,
    mode: 'server',
    json,
    projectPath,
    runWorkflowPath,
    workflowProjectPath,
    godotPath,
    strictPathValidation,
    ciSafe,
    debug,
  };
}

async function readPackageVersion(): Promise<string> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
  const raw = await fs.readFile(packageJsonPath, 'utf8');
  const json = JSON.parse(raw);
  if (!json || typeof json !== 'object' || typeof json.version !== 'string') {
    throw new Error(`Invalid package.json at ${packageJsonPath}`);
  }
  return json.version;
}

async function main() {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
    return;
  }

  if (parsed.showHelp) {
    console.log(usage());
    process.exit(0);
    return;
  }

  if (parsed.showVersion) {
    try {
      const version = await readPackageVersion();
      console.log(version);
      process.exit(0);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SERVER] Failed to read version: ${message}`);
      process.exit(1);
      return;
    }
  }

  if (parsed.debug) process.env.DEBUG = 'true';

  switch (parsed.mode) {
    case 'listToolsJson': {
      const { ALL_TOOL_DEFINITIONS, TOOL_DEFINITION_GROUPS } =
        await import('./tools/definitions/all_tools.js');

      const tools = [...ALL_TOOL_DEFINITIONS]
        .map((t) => t.name)
        .sort((a, b) => a.localeCompare(b));

      const groups: Record<string, string[]> = {};
      for (const groupName of Object.keys(TOOL_DEFINITION_GROUPS).sort(
        (a, b) => a.localeCompare(b),
      )) {
        groups[groupName] = [...TOOL_DEFINITION_GROUPS[groupName]]
          .map((t) => t.name)
          .sort((a, b) => a.localeCompare(b));
      }

      console.log(JSON.stringify({ total: tools.length, tools, groups }));
      process.exit(0);
      return;
    }
    case 'listTools': {
      const { ALL_TOOL_DEFINITIONS, TOOL_DEFINITION_GROUPS } =
        await import('./tools/definitions/all_tools.js');

      const groupNames = Object.keys(TOOL_DEFINITION_GROUPS).sort((a, b) =>
        a.localeCompare(b),
      );
      console.log(`Total tools: ${ALL_TOOL_DEFINITIONS.length}`);

      for (const group of groupNames) {
        const tools = [...TOOL_DEFINITION_GROUPS[group]].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        console.log('');
        console.log(`[${group}] (${tools.length})`);
        for (const tool of tools) {
          console.log(`- ${tool.name}`);
        }
      }

      process.exit(0);
      return;
    }
    case 'printMcpConfig': {
      const __filename = fileURLToPath(import.meta.url);
      const serverPath = path.resolve(__filename);
      const effectiveGodotPath = parsed.godotPath ?? process.env.GODOT_PATH;
      const config: Record<string, unknown> = {
        command: 'node',
        args: [serverPath],
      };
      if (effectiveGodotPath) {
        config.env = { GODOT_PATH: effectiveGodotPath };
      }
      console.log(JSON.stringify(config, null, 2));
      process.exit(0);
      return;
    }
    case 'runScenarios': {
      try {
        const { runScenariosCli } = await import('./scenarios/cli_runner.js');
        const result = await runScenariosCli({
          ciSafe: parsed.ciSafe,
          godotPath: parsed.godotPath,
        });
        process.exit(result.ok ? 0 : 1);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[SCENARIOS] ${message}`);
        process.exit(1);
        return;
      }
    }
    case 'runWorkflow': {
      if (!parsed.runWorkflowPath) {
        console.error(`Missing value for --run-workflow\n\n${usage()}`);
        process.exit(1);
        return;
      }

      try {
        const { runWorkflowCli } = await import('./workflow/cli_runner.js');
        const result = await runWorkflowCli({
          workflowPath: parsed.runWorkflowPath,
          projectPath: parsed.workflowProjectPath,
          godotPath: parsed.godotPath,
          ciSafe: parsed.ciSafe,
        });
        process.exit(result.ok ? 0 : 1);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[WORKFLOW] ${message}`);
        process.exit(1);
        return;
      }
    }
    case 'doctor': {
      const { formatDoctorReport, runDoctor } = await import('./doctor.js');
      const result = await runDoctor({
        projectPath: parsed.projectPath,
        godotPath: parsed.godotPath,
        strictPathValidation: parsed.strictPathValidation,
        readOnly: parsed.doctorReadOnly,
      });
      if (parsed.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatDoctorReport(result));
      }
      process.exit(result.ok ? 0 : 1);
      return;
    }
    case 'server': {
      const { GodotMcpOmniServer } = await import('./server.js');
      const server = new GodotMcpOmniServer({
        godotPath: parsed.godotPath,
        strictPathValidation: parsed.strictPathValidation,
      });

      try {
        await server.run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[SERVER] Failed to start:', message);
        process.exit(1);
      }
      return;
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[SERVER] Failed to start:', message);
  process.exit(1);
});
