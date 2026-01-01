#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

type ParsedArgs = {
  showHelp: boolean;
  showVersion: boolean;
  doctor: boolean;
  json: boolean;
  printMcpConfig: boolean;
  projectPath?: string;
  runScenarios: boolean;
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

  return {
    showHelp,
    showVersion,
    doctor,
    json,
    printMcpConfig,
    projectPath,
    runScenarios,
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

  if (parsed.printMcpConfig) {
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

  if (parsed.projectPath && !parsed.doctor) {
    console.error(`--project is only supported with --doctor\n\n${usage()}`);
    process.exit(1);
    return;
  }

  if (parsed.ciSafe && !parsed.runWorkflowPath && !parsed.runScenarios) {
    console.error(
      `--ci-safe is only supported with --run-workflow or --run-scenarios\n\n${usage()}`,
    );
    process.exit(1);
    return;
  }

  if (parsed.workflowProjectPath && !parsed.runWorkflowPath) {
    console.error(
      `--workflow-project is only supported with --run-workflow\n\n${usage()}`,
    );
    process.exit(1);
    return;
  }

  if (parsed.json && !parsed.doctor) {
    console.error(`--json is only supported with --doctor\n\n${usage()}`);
    process.exit(1);
    return;
  }

  if (parsed.runScenarios) {
    if (
      parsed.doctor ||
      parsed.json ||
      parsed.printMcpConfig ||
      parsed.runWorkflowPath
    ) {
      console.error(
        `--run-scenarios cannot be combined with --doctor/--json/--print-mcp-config/--run-workflow\n\n${usage()}`,
      );
      process.exit(1);
      return;
    }

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

  if (parsed.runWorkflowPath) {
    if (parsed.doctor || parsed.json || parsed.printMcpConfig) {
      console.error(
        `--run-workflow cannot be combined with --doctor/--json/--print-mcp-config\n\n${usage()}`,
      );
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

  if (parsed.doctor) {
    const { formatDoctorReport, runDoctor } = await import('./doctor.js');
    const result = await runDoctor({
      projectPath: parsed.projectPath,
      godotPath: parsed.godotPath,
      strictPathValidation: parsed.strictPathValidation,
    });
    if (parsed.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatDoctorReport(result));
    }
    process.exit(result.ok ? 0 : 1);
    return;
  }

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
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[SERVER] Failed to start:', message);
  process.exit(1);
});
