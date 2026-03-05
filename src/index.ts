#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseArgs, usage, type ParsedArgs } from './cli/args/parse_args.js';

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

function findToolGroup(
  toolName: string,
  groups: Record<string, { name: string }[]>,
): string | null {
  for (const groupName of Object.keys(groups).sort((a, b) =>
    a.localeCompare(b),
  )) {
    if (groups[groupName]?.some((t) => t.name === toolName)) return groupName;
  }
  return null;
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
      for (const groupName of Object.keys(TOOL_DEFINITION_GROUPS).sort((a, b) =>
        a.localeCompare(b),
      )) {
        groups[groupName] = [...TOOL_DEFINITION_GROUPS[groupName]]
          .map((t) => t.name)
          .sort((a, b) => a.localeCompare(b));
      }

      console.log(JSON.stringify({ total: tools.length, tools, groups }));
      process.exit(0);
      return;
    }
    case 'listToolsFullJson': {
      const { ALL_TOOL_DEFINITIONS, TOOL_DEFINITION_GROUPS } =
        await import('./tools/definitions/all_tools.js');

      const tools = [...ALL_TOOL_DEFINITIONS]
        .map((t) => ({
          name: t.name,
          description: t.description ?? null,
          inputSchema: t.inputSchema ?? null,
          outputSchema: t.outputSchema ?? null,
          annotations: t.annotations ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const groups: Record<string, string[]> = {};
      for (const groupName of Object.keys(TOOL_DEFINITION_GROUPS).sort((a, b) =>
        a.localeCompare(b),
      )) {
        groups[groupName] = [...TOOL_DEFINITION_GROUPS[groupName]]
          .map((t) => t.name)
          .sort((a, b) => a.localeCompare(b));
      }

      console.log(JSON.stringify({ total: tools.length, tools, groups }));
      process.exit(0);
      return;
    }
    case 'toolSchema': {
      const name =
        typeof parsed.toolName === 'string' && parsed.toolName.trim()
          ? parsed.toolName.trim()
          : null;
      if (!name) {
        console.log(
          JSON.stringify({
            ok: false,
            error: {
              code: 'E_SCHEMA_VALIDATION',
              message: 'Missing value for --tool-schema',
            },
          }),
        );
        process.exit(1);
        return;
      }

      const { ALL_TOOL_DEFINITIONS, TOOL_DEFINITION_GROUPS } =
        await import('./tools/definitions/all_tools.js');

      const tool = ALL_TOOL_DEFINITIONS.find((t) => t.name === name) ?? null;
      if (!tool) {
        console.log(
          JSON.stringify({
            ok: false,
            error: {
              code: 'E_NOT_FOUND',
              message: `Unknown tool: ${name}`,
              details: { tool: name },
            },
          }),
        );
        process.exit(1);
        return;
      }

      const group = findToolGroup(name, TOOL_DEFINITION_GROUPS);
      console.log(
        JSON.stringify({
          ok: true,
          tool: {
            name: tool.name,
            description: tool.description ?? null,
            inputSchema: tool.inputSchema ?? null,
            outputSchema: tool.outputSchema ?? null,
            annotations: tool.annotations ?? null,
          },
          group,
        }),
      );
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
    case 'listScenarios': {
      const { DEFAULT_CI_SAFE_SCENARIOS } =
        await import('./scenarios/default_scenarios.js');

      const scenarios = [...DEFAULT_CI_SAFE_SCENARIOS].sort((a, b) =>
        a.id.localeCompare(b.id),
      );

      console.log(`Total scenarios: ${scenarios.length}`);
      for (const s of scenarios) {
        console.log(`- ${s.id}: ${s.title}`);
      }

      process.exit(0);
      return;
    }
    case 'listScenariosJson': {
      const { DEFAULT_CI_SAFE_SCENARIOS } =
        await import('./scenarios/default_scenarios.js');

      const scenarios = [...DEFAULT_CI_SAFE_SCENARIOS]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((s) => ({ id: s.id, title: s.title, tool: s.tool }));

      console.log(JSON.stringify({ total: scenarios.length, scenarios }));
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
          jsonStdout: parsed.scenariosJson,
          scenarioIds: parsed.scenarioIds,
          report: {
            noReport: parsed.scenariosNoReport,
            outDir: parsed.scenariosOutDir,
            reportPath: parsed.scenariosReportPath,
            mdReportPath: parsed.scenariosMdReportPath,
          },
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
          jsonStdout: parsed.workflowJson,
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
    case 'doctorReport': {
      if (!parsed.projectPath) {
        console.log(
          JSON.stringify({
            ok: false,
            error: {
              code: 'E_SCHEMA_VALIDATION',
              message:
                'Missing value for --project (required for --doctor-report)',
            },
          }),
        );
        process.exit(1);
        return;
      }

      try {
        const { runDoctorReportCli } =
          await import('./doctor_report/cli_runner.js');
        const result = await runDoctorReportCli({
          projectPath: parsed.projectPath,
          reportRelativePath: parsed.doctorReportPath,
          godotPath: parsed.godotPath,
        });
        console.log(JSON.stringify(result.output, null, 2));
        process.exit(result.exitCode);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(
          JSON.stringify({
            ok: false,
            error: {
              code: 'E_DOCTOR_REPORT_CLI',
              message,
            },
          }),
        );
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
