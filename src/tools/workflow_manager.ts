import path from 'path';
import fs from 'fs/promises';

import {
  ValidationError,
  asNonEmptyString,
  asOptionalNonEmptyString,
  asRecord,
  valueType,
} from '../validation.js';
import {
  deepSubstitute,
  validateWorkflowJson,
  type NormalizedWorkflow,
} from '../workflow/workflow_validation.js';

import type { ToolDefinition } from './definitions/tool_definition.js';
import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';

type WorkflowRunStepResult = {
  index: number; // 1-based
  id: string;
  title: string;
  tool: string;
  expectedOk: boolean;
  actualOk: boolean;
  summary: string;
};

type WorkflowManagerDeps = {
  dispatchTool: (tool: string, args: unknown) => Promise<ToolResponse>;
  normalizeParameters: (params: unknown) => unknown;
  listTools: () => ToolDefinition[];
  macroManager?: ToolHandler;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveOptionalPath(input: string | null): string | null {
  if (!input || input.trim().length === 0) return null;
  return path.resolve(process.cwd(), input.trim());
}

export function createWorkflowManagerToolHandlers(
  _ctx: ServerContext,
  deps: WorkflowManagerDeps,
): Record<string, ToolHandler> {
  return {
    workflow_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const action = asNonEmptyString(argsObj.action, 'action');
      const trimmedAction = action.trim();

      const macroActionMap: Record<string, string> = {
        'macro.list': 'list_macros',
        'macro.describe': 'describe_macro',
        'macro.manifest_get': 'manifest_get',
        'macro.plan': 'plan',
        'macro.run': 'run',
        'macro.resume': 'resume',
        'macro.validate': 'validate',
      };

      const macroMapped = macroActionMap[trimmedAction] ?? null;
      if (macroMapped) {
        if (!deps.macroManager) {
          return {
            ok: false,
            summary: 'Macro actions are unavailable (server misconfiguration)',
            details: { action: trimmedAction },
            logs: [],
          };
        }
        const forwardedArgs: Record<string, unknown> = {
          ...argsObj,
          action: macroMapped,
        };
        return await deps.macroManager(forwardedArgs);
      }

      if (trimmedAction !== 'validate' && trimmedAction !== 'run') {
        throw new ValidationError(
          'action',
          'Invalid field "action": expected "validate", "run", or "macro.*"',
          valueType(action),
        );
      }

      const hasWorkflow =
        argsObj.workflow !== undefined && argsObj.workflow !== null;
      const workflowPath = asOptionalNonEmptyString(
        argsObj.workflowPath,
        'workflowPath',
      );
      if ((hasWorkflow ? 1 : 0) + (workflowPath ? 1 : 0) !== 1) {
        throw new ValidationError(
          'workflow',
          'Provide exactly one of "workflow" or "workflowPath"',
          valueType(argsObj.workflow),
        );
      }

      const projectPathOverride = asOptionalNonEmptyString(
        argsObj.projectPath,
        'projectPath',
      );

      let rawWorkflow: unknown = null;
      let workflowPathForErrors: string | null = null;

      if (workflowPath) {
        workflowPathForErrors = path.resolve(process.cwd(), workflowPath);
        try {
          const raw = await fs.readFile(workflowPathForErrors, 'utf8');
          rawWorkflow = JSON.parse(raw);
        } catch (error) {
          throw new Error(
            `Failed to load workflow JSON (${workflowPathForErrors}): ${String(
              error instanceof Error ? error.message : error,
            )}`,
          );
        }
      } else {
        rawWorkflow = asRecord(argsObj.workflow, 'workflow');
      }

      const workflow: NormalizedWorkflow = validateWorkflowJson(rawWorkflow, {
        workflowPathForErrors,
        allowWorkflowManagerTool: trimmedAction === 'validate',
      });

      const projectPathInput =
        typeof projectPathOverride === 'string' && projectPathOverride.trim()
          ? projectPathOverride.trim()
          : workflow.projectPath;
      const resolvedProjectPath = resolveOptionalPath(projectPathInput);

      const substitutions = { $PROJECT_PATH: resolvedProjectPath ?? '' };

      if (trimmedAction === 'validate') {
        return {
          ok: true,
          summary: 'Workflow validated',
          details: { workflow, resolvedProjectPath },
          logs: [],
        };
      }

      const stepResults: WorkflowRunStepResult[] = [];

      for (let index = 0; index < workflow.steps.length; index += 1) {
        const step = workflow.steps[index];
        try {
          if (step.tool === 'tools/list') {
            if (step.expectOk !== true) {
              throw new Error('tools/list does not support expectOk=false');
            }

            const tools = deps.listTools();
            const names = tools
              .map((t) => t?.name)
              .filter((n): n is string => typeof n === 'string')
              .sort((a, b) => a.localeCompare(b));

            stepResults.push({
              index: index + 1,
              id: step.id,
              title: step.title,
              tool: step.tool,
              expectedOk: step.expectOk,
              actualOk: true,
              summary: `tools/list (${names.length} tools)`,
            });
            continue;
          }

          const substitutedArgs = deepSubstitute(step.args, substitutions);
          if (!isRecord(substitutedArgs)) {
            throw new Error(
              `Invalid substituted args for step ${index + 1} (id=${step.id}): expected an object`,
            );
          }

          const normalizedArgs = deps.normalizeParameters(substitutedArgs);
          const resp = await deps.dispatchTool(step.tool, normalizedArgs);

          if (resp.ok !== step.expectOk) {
            throw new Error(
              `Expected ok=${step.expectOk}, got ok=${resp.ok} (${resp.summary ?? 'no summary'})`,
            );
          }
          if (!resp.ok) throw new Error(resp.summary ?? 'Tool failed');

          stepResults.push({
            index: index + 1,
            id: step.id,
            title: step.title,
            tool: step.tool,
            expectedOk: step.expectOk,
            actualOk: resp.ok,
            summary: resp.summary,
          });
        } catch (error) {
          const message = String(
            error instanceof Error ? error.message : error,
          );
          return {
            ok: false,
            summary: `Step ${index + 1} (id=${step.id}) failed: ${message}`,
            details: {
              workflow,
              resolvedProjectPath,
              steps: stepResults,
              failedStep: {
                index: index + 1,
                id: step.id,
                title: step.title,
                tool: step.tool,
                expectedOk: step.expectOk,
              },
            },
            logs: [],
          };
        }
      }

      return {
        ok: true,
        summary: 'Workflow completed',
        details: { workflow, resolvedProjectPath, steps: stepResults },
        logs: [],
      };
    },
  };
}
