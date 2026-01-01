import type { ToolDefinition } from './tool_definition.js';

export const WORKFLOW_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'workflow_manager',
    description:
      'Validate or run a workflow (a sequential list of tool calls) inside the server process.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['validate', 'run'] },
        workflow: {
          type: 'object',
          description:
            'Workflow object. Provide either workflow or workflowPath. schemaVersion must be 1 and steps must be an array of { tool, args?, expectOk? }.',
        },
        workflowPath: {
          type: 'string',
          description:
            'Path to a workflow JSON file. Provide either workflow or workflowPath.',
        },
        projectPath: {
          type: 'string',
          description:
            'Optional override for "$PROJECT_PATH" substitution (same semantics as scripts/run_workflow.js --project).',
        },
      },
      required: ['action'],
    },
  },
];
