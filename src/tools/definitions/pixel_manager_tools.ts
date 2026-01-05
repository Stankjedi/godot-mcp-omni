import type { ToolDefinition } from './tool_definition.js';
import { actionOneOfSchema, looseObjectSchema } from './schema.js';

export const PIXEL_MANAGER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'pixel_manager',
    description:
      'Unified entrypoint for the 2D pixel pipeline (multi-action manager).',
    inputSchema: {
      ...(() => {
        const props = {
          projectPath: {
            type: 'string',
            description: 'Path to the Godot project',
          },
          goal: { type: 'string' },
          plan: { type: 'array' },
          spec: looseObjectSchema({
            description: 'Pixel pipeline spec object.',
          }),
          worldScenePath: { type: 'string' },
          seed: { type: 'number' },
          dryRun: { type: 'boolean' },
          failFast: { type: 'boolean' },
          forceRegenerate: { type: 'boolean' },
          reuseExistingSheet: { type: 'boolean' },
          allowExternalTools: { type: 'boolean' },
          imageGenMode: {
            type: 'string',
            description:
              'Optional: image generation mode for actions that need PNG inputs (ex: tilemap_generate/object_generate). Use "manual_drop" to require PNGs to already exist.',
            enum: ['auto', 'manual_drop'],
          },
          timeoutMs: { type: 'number' },
          specGenTimeoutMs: { type: 'number' },
          exportPreview: { type: 'boolean' },
          smokeTest: { type: 'boolean' },
          waitMs: {
            type: 'number',
            description: 'Wait time for action="smoke_test".',
          },
          smokeWaitMs: {
            type: 'number',
            description: 'Smoke test wait time for action="macro_run".',
          },
          previewOutputPngPath: { type: 'string' },
          scenePath: { type: 'string' },
          layerName: { type: 'string' },
          outputPngPath: { type: 'string' },
        };

        const commonOptional = [
          'projectPath',
          'goal',
          'plan',
          'spec',
          'worldScenePath',
          'seed',
          'dryRun',
          'failFast',
          'forceRegenerate',
          'reuseExistingSheet',
          'allowExternalTools',
          'imageGenMode',
          'timeoutMs',
          'specGenTimeoutMs',
          'exportPreview',
          'smokeTest',
          'waitMs',
          'smokeWaitMs',
          'previewOutputPngPath',
          'scenePath',
          'layerName',
          'outputPngPath',
        ];

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional,
          variants: [
            {
              action: 'project_analyze',
              required: ['projectPath'],
              optional: [],
            },
            {
              action: 'goal_to_spec',
              required: ['projectPath', 'goal'],
              optional: [],
            },
            {
              action: 'tilemap_generate',
              required: ['projectPath', 'spec'],
              optional: [],
            },
            {
              action: 'world_generate',
              required: ['projectPath', 'spec'],
              optional: [],
            },
            {
              action: 'layer_ensure',
              required: ['projectPath', 'spec'],
              optional: [],
            },
            {
              action: 'object_generate',
              required: ['projectPath', 'spec'],
              optional: [],
            },
            {
              action: 'object_place',
              required: ['projectPath', 'worldScenePath', 'spec'],
              optional: [],
            },
            {
              action: 'export_preview',
              required: ['projectPath'],
              optional: ['scenePath', 'layerName', 'outputPngPath'],
            },
            {
              action: 'smoke_test',
              required: ['projectPath'],
              optional: ['waitMs', 'scenePath'],
            },
            {
              action: 'macro_run',
              required: ['projectPath'],
              optional: [
                'goal',
                'plan',
                'seed',
                'dryRun',
                'failFast',
                'forceRegenerate',
                'allowExternalTools',
                'specGenTimeoutMs',
                'exportPreview',
                'smokeTest',
                'smokeWaitMs',
                'previewOutputPngPath',
              ],
            },
            { action: 'manifest_get', required: ['projectPath'], optional: [] },
          ],
        });
      })(),
    },
    annotations: {
      destructiveHint: true,
      headlessHint: true,
      managerHint: true,
    },
  },
];
