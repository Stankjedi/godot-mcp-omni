import type { ToolDefinition } from './tool_definition.js';
import {
  actionOneOfSchema,
  looseObjectSchema,
  strictObjectSchema,
} from './schema.js';

export const WORKFLOW_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'workflow_manager',
    description:
      'Validate or run a workflow (a sequential list of tool calls) inside the server process; also provides macro.* actions for scaffolding workflows.',
    inputSchema: {
      ...(() => {
        const props = {
          workflow: looseObjectSchema({
            description:
              'Workflow object. Provide either workflow or workflowPath. schemaVersion must be 1 and steps must be an array of { tool, args?, expectOk? }.',
          }),
          workflowPath: {
            type: 'string',
            description:
              'Path to a workflow JSON file. Provide either workflow or workflowPath.',
          },
          projectPath: {
            type: 'string',
            description:
              'Project path (required for most macro.* actions; optional override for "$PROJECT_PATH" substitution in workflow.validate/run).',
          },

          macroId: { type: 'string', description: 'Macro identifier' },
          macros: {
            type: 'array',
            description:
              'List of macros to run/plan (strings or objects like { macroId })',
            items: { anyOf: [{ type: 'string' }, looseObjectSchema({})] },
          },
          dryRun: {
            type: 'boolean',
            description:
              'When action=macro.run: plan only; do not apply changes',
          },
          forceRegenerate: {
            type: 'boolean',
            description:
              'When action=macro.run: allow overwriting existing outputs (requires ALLOW_DANGEROUS_OPS=true).',
          },
          validate: {
            type: 'boolean',
            description:
              'When action=macro.run: validate created scenes with validate_scene (headless).',
          },
          scenes: {
            type: 'array',
            description:
              'When action=macro.validate: list of scenes to validate (res://...)',
            items: { type: 'string' },
          },
          pixel: strictObjectSchema({
            description:
              'Optional: run pixel_manager(action="macro_run") before executing macros (level pipeline). Requires pixel.goal or pixel.plan.',
            properties: {
              goal: { type: 'string' },
              plan: { type: 'array' },
              seed: { type: 'number' },
              failFast: { type: 'boolean' },
              allowExternalTools: { type: 'boolean' },
              specGenTimeoutMs: { type: 'number' },
              exportPreview: { type: 'boolean' },
              smokeTest: { type: 'boolean' },
              smokeWaitMs: { type: 'number' },
              previewOutputPngPath: { type: 'string' },
              scenePath: { type: 'string' },
              layerName: { type: 'string' },
              outputPngPath: { type: 'string' },
              dryRun: { type: 'boolean' },
              forceRegenerate: { type: 'boolean' },
            },
          }),
          composeMainScene: {
            type: 'boolean',
            description:
              'When action=macro.plan/macro.run: create a Main scene that instances the pixel world + macro-generated scenes.',
          },
          mainScenePath: {
            type: 'string',
            description:
              'Optional: output path for the composed Main scene (default: res://scenes/generated/macro/Main.tscn)',
          },
        };

        const workflowSourceOneOf = {
          oneOf: [
            { required: ['workflow'], not: { required: ['workflowPath'] } },
            { required: ['workflowPath'], not: { required: ['workflow'] } },
          ],
        };

        const macroListOneOf = {
          oneOf: [{ required: ['macroId'] }, { required: ['macros'] }],
        };

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional: ['projectPath'],
          variants: [
            {
              action: 'validate',
              required: [],
              optional: ['workflow', 'workflowPath'],
              oneOf: [workflowSourceOneOf],
            },
            {
              action: 'run',
              required: [],
              optional: ['workflow', 'workflowPath'],
              oneOf: [workflowSourceOneOf],
            },
            { action: 'macro.list', required: [], optional: [] },
            {
              action: 'macro.describe',
              required: ['projectPath', 'macroId'],
              optional: [],
            },
            {
              action: 'macro.manifest_get',
              required: ['projectPath'],
              optional: [],
            },
            {
              action: 'macro.plan',
              required: ['projectPath'],
              optional: [
                'macroId',
                'macros',
                'pixel',
                'composeMainScene',
                'mainScenePath',
              ],
              oneOf: [macroListOneOf],
            },
            {
              action: 'macro.run',
              required: ['projectPath'],
              optional: [
                'macroId',
                'macros',
                'dryRun',
                'forceRegenerate',
                'validate',
                'pixel',
                'composeMainScene',
                'mainScenePath',
              ],
              oneOf: [macroListOneOf],
            },
            {
              action: 'macro.resume',
              required: ['projectPath'],
              optional: [],
            },
            {
              action: 'macro.validate',
              required: ['projectPath'],
              optional: ['scenes'],
            },
          ],
        });
      })(),
    },
    annotations: { destructiveHint: true },
  },
];
