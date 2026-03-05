type CliMode =
  | 'server'
  | 'doctor'
  | 'doctorReport'
  | 'listTools'
  | 'listToolsJson'
  | 'listToolsFullJson'
  | 'listScenarios'
  | 'listScenariosJson'
  | 'toolSchema'
  | 'printMcpConfig'
  | 'runScenarios'
  | 'runWorkflow';

export type ParsedArgs = {
  showHelp: boolean;
  showVersion: boolean;
  mode: CliMode;
  doctorReadOnly: boolean;
  json: boolean;
  toolName?: string;
  projectPath?: string;
  doctorReportPath?: string;
  runWorkflowPath?: string;
  workflowJson: boolean;
  workflowProjectPath?: string;
  scenariosNoReport: boolean;
  scenariosJson: boolean;
  scenarioIds: string[];
  scenariosOutDir?: string;
  scenariosReportPath?: string;
  scenariosMdReportPath?: string;
  godotPath?: string;
  strictPathValidation: boolean;
  ciSafe: boolean;
  debug: boolean;
};

export function usage() {
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
    '  --doctor-report             Generate a project doctor report (Markdown) via MCP and exit',
    '  --project <path>            Project path (optional for --doctor, required for --doctor-report)',
    '  --doctor-report-path <path> With --doctor-report: report output path (default: .godot_mcp/reports/doctor_report.md)',
    '  --run-scenarios             Run the CI-safe scenario suite and exit',
    '  --scenarios-json            With --run-scenarios: print the final report as JSON-only stdout',
    '  --scenario <id>             With --run-scenarios: run only selected scenario(s) (repeatable)',
    '  --out-dir <dir>             With --run-scenarios: write scenario reports into <dir>',
    '  --report <path>             With --run-scenarios: write JSON report to <path> (overrides --out-dir)',
    '  --md-report <path>          With --run-scenarios: write Markdown report to <path> (overrides --out-dir)',
    '  --no-report                 With --run-scenarios: run but do not write report files',
    '  --run-workflow <path>       Run a workflow JSON and exit',
    '  --workflow-json             With --run-workflow: print the final result as JSON-only stdout',
    '  --workflow-project <path>   Override $PROJECT_PATH for --run-workflow',
    '  --ci-safe                   Workflow/scenarios: force GODOT_PATH=""',
    '  --godot-path <path>         Override Godot executable path',
    '  --strict-path-validation    Enable strict Godot path validation',
    '  --debug                     Enable debug logs (sets DEBUG=true)',
    '  --print-mcp-config          Print MCP server config JSON and exit',
    '  --list-tools                Print available MCP tools and exit',
    '  --list-tools-json           Print available MCP tools as JSON and exit',
    '  --list-tools-full-json      Print all MCP tool definitions as JSON and exit',
    '  --list-scenarios            Print available CI-safe scenario IDs and exit',
    '  --list-scenarios-json       Print available CI-safe scenarios as JSON and exit',
    '  --tool-schema <toolName>    Print a single tool definition as JSON and exit',
    '',
    'Notes:',
    '  - Without options, the server starts and communicates over stdin/stdout.',
    '  - You can also configure GODOT_PATH via environment variables.',
    '  - With --run-scenarios and no output flags, reports are written to devplan/scenario_run_report.json and devplan/scenario_run_report.md (use --no-report to disable).',
  ].join('\n');
}

type ParsedArgsBase = Omit<ParsedArgs, 'mode'>;

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let showHelp = false;
  let showVersion = false;
  let doctor = false;
  let doctorReport = false;
  let listTools = false;
  let listToolsJson = false;
  let listToolsFullJson = false;
  let listScenarios = false;
  let listScenariosJson = false;
  let doctorReadOnly = false;
  let json = false;
  let printMcpConfig = false;
  let projectPath: string | undefined;
  let doctorReportPath: string | undefined;
  let toolName: string | undefined;
  let runScenarios = false;
  let runWorkflowPath: string | undefined;
  let workflowJson = false;
  let workflowProjectPath: string | undefined;
  let scenariosNoReport = false;
  let scenariosJson = false;
  const scenarioIds: string[] = [];
  let scenariosOutDir: string | undefined;
  let scenariosReportPath: string | undefined;
  let scenariosMdReportPath: string | undefined;
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
    if (a === '--doctor-report') {
      doctorReport = true;
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
    if (a === '--list-tools-full-json') {
      listToolsFullJson = true;
      continue;
    }
    if (a === '--list-scenarios') {
      listScenarios = true;
      continue;
    }
    if (a === '--list-scenarios-json') {
      listScenariosJson = true;
      continue;
    }
    if (a === '--tool-schema') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --tool-schema\n\n${usage()}`);
      }
      toolName = value;
      i += 1;
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
    if (a === '--workflow-json') {
      workflowJson = true;
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
    if (a === '--doctor-report-path') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --doctor-report-path\n\n${usage()}`);
      }
      doctorReportPath = value;
      i += 1;
      continue;
    }
    if (a === '--run-scenarios') {
      runScenarios = true;
      continue;
    }
    if (a === '--scenarios-json') {
      scenariosJson = true;
      continue;
    }
    if (a === '--scenario') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --scenario\n\n${usage()}`);
      }
      scenarioIds.push(value);
      i += 1;
      continue;
    }
    if (a === '--no-report') {
      scenariosNoReport = true;
      continue;
    }
    if (a === '--out-dir') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --out-dir\n\n${usage()}`);
      }
      scenariosOutDir = value;
      i += 1;
      continue;
    }
    if (a === '--report') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --report\n\n${usage()}`);
      }
      scenariosReportPath = value;
      i += 1;
      continue;
    }
    if (a === '--md-report') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for --md-report\n\n${usage()}`);
      }
      scenariosMdReportPath = value;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${a}\n\n${usage()}`);
  }

  const base: ParsedArgsBase = {
    showHelp,
    showVersion,
    doctorReadOnly,
    json,
    toolName,
    projectPath,
    doctorReportPath,
    runWorkflowPath,
    workflowJson,
    workflowProjectPath,
    scenariosNoReport,
    scenariosJson,
    scenarioIds,
    scenariosOutDir,
    scenariosReportPath,
    scenariosMdReportPath,
    godotPath,
    strictPathValidation,
    ciSafe,
    debug,
  };

  if (!showHelp && !showVersion) {
    const hasScenarioReportFlags =
      scenariosNoReport ||
      Boolean(scenariosOutDir) ||
      Boolean(scenariosReportPath) ||
      Boolean(scenariosMdReportPath);

    if (
      (hasScenarioReportFlags || scenariosJson || scenarioIds.length > 0) &&
      !runScenarios
    ) {
      throw new Error(
        `--out-dir/--report/--md-report/--no-report/--scenarios-json/--scenario are only supported with --run-scenarios\n\n${usage()}`,
      );
    }

    if (workflowJson && !runWorkflowPath) {
      throw new Error(
        `--workflow-json is only supported with --run-workflow\n\n${usage()}`,
      );
    }

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
        listToolsFullJson ||
        listScenarios ||
        listScenariosJson ||
        doctor ||
        doctorReport ||
        doctorReadOnly ||
        json ||
        printMcpConfig ||
        projectPath ||
        doctorReportPath ||
        toolName ||
        runScenarios ||
        runWorkflowPath ||
        workflowJson ||
        workflowProjectPath ||
        ciSafe ||
        godotPath ||
        strictPathValidation ||
        debug
      ) {
        throw new Error(
          `--list-tools-json cannot be combined with ` +
            `--list-tools/--doctor/--doctor-report/--json/--print-mcp-config/--project/--doctor-report-path/--tool-schema/--run-scenarios/--run-workflow/--workflow-project/--ci-safe/--godot-path/--strict-path-validation/--debug\n\n${usage()}`,
        );
      }

      return { ...base, mode: 'listToolsJson' };
    }

    if (listToolsFullJson) {
      if (
        listTools ||
        listToolsJson ||
        listScenarios ||
        listScenariosJson ||
        doctor ||
        doctorReport ||
        doctorReadOnly ||
        json ||
        printMcpConfig ||
        projectPath ||
        doctorReportPath ||
        toolName ||
        runScenarios ||
        runWorkflowPath ||
        workflowJson ||
        workflowProjectPath ||
        ciSafe ||
        godotPath ||
        strictPathValidation ||
        debug
      ) {
        throw new Error(
          `--list-tools-full-json cannot be combined with ` +
            `--list-tools/--list-tools-json/--doctor/--doctor-report/--json/--print-mcp-config/--project/--doctor-report-path/--tool-schema/--run-scenarios/--run-workflow/--workflow-project/--ci-safe/--godot-path/--strict-path-validation/--debug\n\n${usage()}`,
        );
      }

      return { ...base, mode: 'listToolsFullJson' };
    }

    if (listScenariosJson) {
      if (
        listScenarios ||
        listTools ||
        listToolsJson ||
        listToolsFullJson ||
        doctor ||
        doctorReport ||
        doctorReadOnly ||
        json ||
        printMcpConfig ||
        projectPath ||
        doctorReportPath ||
        toolName ||
        runScenarios ||
        runWorkflowPath ||
        workflowJson ||
        workflowProjectPath ||
        ciSafe ||
        godotPath ||
        strictPathValidation ||
        debug
      ) {
        throw new Error(
          `--list-scenarios-json cannot be combined with ` +
            `--list-scenarios/--list-tools*/--doctor/--doctor-report/--json/--print-mcp-config/--project/--doctor-report-path/--tool-schema/--run-scenarios/--run-workflow/--workflow-json/--workflow-project/--ci-safe/--godot-path/--strict-path-validation/--debug\n\n${usage()}`,
        );
      }

      return { ...base, mode: 'listScenariosJson' };
    }

    if (listScenarios) {
      if (
        listScenariosJson ||
        listTools ||
        listToolsJson ||
        listToolsFullJson ||
        doctor ||
        doctorReport ||
        doctorReadOnly ||
        json ||
        printMcpConfig ||
        projectPath ||
        doctorReportPath ||
        toolName ||
        runScenarios ||
        runWorkflowPath ||
        workflowJson ||
        workflowProjectPath ||
        ciSafe ||
        godotPath ||
        strictPathValidation ||
        debug
      ) {
        throw new Error(
          `--list-scenarios cannot be combined with ` +
            `--list-scenarios-json/--list-tools*/--doctor/--doctor-report/--json/--print-mcp-config/--project/--doctor-report-path/--tool-schema/--run-scenarios/--run-workflow/--workflow-json/--workflow-project/--ci-safe/--godot-path/--strict-path-validation/--debug\n\n${usage()}`,
        );
      }

      return { ...base, mode: 'listScenarios' };
    }

    if (toolName) {
      if (
        listTools ||
        listScenarios ||
        listScenariosJson ||
        doctor ||
        doctorReport ||
        doctorReadOnly ||
        listToolsJson ||
        listToolsFullJson ||
        json ||
        printMcpConfig ||
        projectPath ||
        doctorReportPath ||
        runScenarios ||
        runWorkflowPath ||
        workflowJson ||
        workflowProjectPath ||
        ciSafe ||
        godotPath ||
        strictPathValidation
      ) {
        throw new Error(
          `--tool-schema cannot be combined with ` +
            `--list-tools/--list-tools-json/--doctor/--doctor-report/--doctor-readonly/--json/--print-mcp-config/--project/--doctor-report-path/--run-scenarios/--run-workflow/--workflow-project/--ci-safe/--godot-path/--strict-path-validation\n\n${usage()}`,
        );
      }

      return { ...base, mode: 'toolSchema' };
    }

    if (listTools) {
      if (
        listScenarios ||
        listScenariosJson ||
        doctor ||
        doctorReport ||
        doctorReadOnly ||
        listToolsJson ||
        listToolsFullJson ||
        json ||
        printMcpConfig ||
        projectPath ||
        doctorReportPath ||
        toolName ||
        runScenarios ||
        runWorkflowPath ||
        workflowJson ||
        workflowProjectPath ||
        ciSafe ||
        godotPath ||
        strictPathValidation
      ) {
        throw new Error(
          `--list-tools cannot be combined with ` +
            `--doctor/--doctor-report/--json/--print-mcp-config/--project/--doctor-report-path/--tool-schema/--run-scenarios/--run-workflow/--workflow-project/--ci-safe/--godot-path/--strict-path-validation\n\n${usage()}`,
        );
      }

      return { ...base, mode: 'listTools' };
    }

    if (printMcpConfig) {
      if (doctor || doctorReport || runScenarios || runWorkflowPath) {
        throw new Error(
          `--print-mcp-config cannot be combined with ` +
            `--doctor/--doctor-report/--run-scenarios/--run-workflow\n\n${usage()}`,
        );
      }

      return { ...base, mode: 'printMcpConfig' };
    }

    if (doctorReportPath && !doctorReport) {
      throw new Error(
        `--doctor-report-path is only supported with --doctor-report\n\n${usage()}`,
      );
    }

    if (doctorReport) {
      if (
        doctor ||
        doctorReadOnly ||
        json ||
        listTools ||
        listToolsJson ||
        listToolsFullJson ||
        printMcpConfig ||
        toolName ||
        runScenarios ||
        runWorkflowPath ||
        workflowProjectPath ||
        ciSafe
      ) {
        throw new Error(
          `--doctor-report cannot be combined with ` +
            `--doctor/--doctor-readonly/--json/--print-mcp-config/--list-tools*/--tool-schema/--run-scenarios/--run-workflow/--workflow-project/--ci-safe\n\n${usage()}`,
        );
      }

      if (!projectPath) {
        throw new Error(
          `Missing value for --project (required for --doctor-report)\n\n${usage()}`,
        );
      }

      return { ...base, mode: 'doctorReport' };
    }

    if (projectPath && !doctor) {
      throw new Error(
        `--project is only supported with --doctor or --doctor-report\n\n${usage()}`,
      );
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

      return { ...base, mode: 'runScenarios' };
    }

    if (runWorkflowPath) {
      if (doctor || json || printMcpConfig) {
        throw new Error(
          `--run-workflow cannot be combined with --doctor/--json/--print-mcp-config\n\n${usage()}`,
        );
      }

      return { ...base, mode: 'runWorkflow' };
    }

    if (doctor) {
      return { ...base, mode: 'doctor' };
    }
  }

  return { ...base, mode: 'server' };
}
