export type NormalizedWorkflowStep = {
  id: string;
  title: string;
  tool: string;
  args: Record<string, unknown>;
  expectOk: boolean;
};

export type NormalizedWorkflow = {
  schemaVersion: 1;
  projectPath: string | null;
  steps: NormalizedWorkflowStep[];
};

type ValidateWorkflowOptions = {
  workflowPathForErrors?: string | null;
  allowWorkflowManagerTool?: boolean;
};

import { isRecord } from '../utils/object_shape.js';

export { deepSubstitute } from '../utils/object_shape.js';

function formatStepRef(index: number, step: unknown): string {
  const id =
    isRecord(step) && typeof step.id === 'string' && step.id.trim()
      ? step.id.trim()
      : null;
  const parts = [`index=${index}`];
  if (id) parts.push(`id=${id}`);
  return `(${parts.join(', ')})`;
}

export function validateWorkflowJson(
  workflow: unknown,
  options: ValidateWorkflowOptions = {},
): NormalizedWorkflow {
  const workflowPathForErrors = options.workflowPathForErrors ?? null;
  const allowWorkflowManagerTool = options.allowWorkflowManagerTool === true;

  if (!isRecord(workflow)) {
    const prefix = workflowPathForErrors
      ? `Invalid workflow JSON (${workflowPathForErrors}):`
      : 'Invalid workflow JSON:';
    throw new Error(`${prefix} expected an object`);
  }

  const schemaVersion = workflow.schemaVersion;
  if (schemaVersion !== 1) {
    const got =
      schemaVersion === undefined ? 'missing' : JSON.stringify(schemaVersion);
    const prefix = workflowPathForErrors
      ? `Invalid workflow JSON (${workflowPathForErrors}):`
      : 'Invalid workflow JSON:';
    throw new Error(`${prefix} schemaVersion must be 1 (got ${got})`);
  }

  if (!Array.isArray(workflow.steps)) {
    const prefix = workflowPathForErrors
      ? `Invalid workflow JSON (${workflowPathForErrors}):`
      : 'Invalid workflow JSON:';
    throw new Error(`${prefix} steps must be an array`);
  }

  const normalizedSteps = workflow.steps.map((step, index) => {
    if (!isRecord(step)) {
      throw new Error(
        `Invalid workflow step ${formatStepRef(index, step)}: expected an object`,
      );
    }

    const tool = step.tool;
    if (typeof tool !== 'string' || tool.trim().length === 0) {
      throw new Error(
        `Invalid workflow step ${formatStepRef(index, step)}: tool must be a non-empty string`,
      );
    }

    const toolName = tool.trim();
    if (!allowWorkflowManagerTool && toolName === 'workflow_manager') {
      throw new Error(
        `Invalid workflow step ${formatStepRef(index, step)}: tool cannot be "workflow_manager" (recursion is not allowed)`,
      );
    }

    if ('args' in step && step.args !== undefined) {
      if (!isRecord(step.args)) {
        throw new Error(
          `Invalid workflow step ${formatStepRef(index, step)}: args must be an object when provided`,
        );
      }
    }

    if ('expectOk' in step && step.expectOk !== undefined) {
      if (typeof step.expectOk !== 'boolean') {
        throw new Error(
          `Invalid workflow step ${formatStepRef(index, step)}: expectOk must be a boolean when provided`,
        );
      }
    }

    const id =
      typeof step.id === 'string' && step.id.trim()
        ? step.id.trim()
        : `STEP-${index + 1}`;
    const title =
      typeof step.title === 'string' && step.title.trim()
        ? step.title.trim()
        : toolName;
    const args = (step.args ?? {}) as Record<string, unknown>;
    const expectOk = typeof step.expectOk === 'boolean' ? step.expectOk : true;

    return {
      id,
      title,
      tool: toolName,
      args,
      expectOk,
    };
  });

  const projectPath =
    typeof workflow.projectPath === 'string' && workflow.projectPath.trim()
      ? workflow.projectPath.trim()
      : null;

  return {
    schemaVersion: 1,
    projectPath,
    steps: normalizedSteps,
  };
}
