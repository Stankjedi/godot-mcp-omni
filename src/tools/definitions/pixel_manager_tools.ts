import type { ToolDefinition } from './tool_definition.js';

export const PIXEL_MANAGER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'pixel_manager',
    description:
      'Unified wrapper for the 2D pixel pipeline tools (maps action -> pixel_*).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Pixel pipeline action',
          enum: [
            'project_analyze',
            'goal_to_spec',
            'tilemap_generate',
            'world_generate',
            'layer_ensure',
            'object_generate',
            'object_place',
            'export_preview',
            'smoke_test',
            'macro_run',
            'manifest_get',
          ],
        },
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },

        // Pass-through fields for underlying pixel_* tools
        goal: { type: 'string' },
        plan: { type: 'array' },
        spec: { type: 'object' },
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
          description:
            'Wait time for action="smoke_test" (forwarded to pixel_smoke_test.waitMs)',
        },
        smokeWaitMs: {
          type: 'number',
          description:
            'Smoke test wait time for action="macro_run" (forwarded to pixel_macro_run.smokeWaitMs)',
        },
        previewOutputPngPath: { type: 'string' },
        scenePath: { type: 'string' },
        layerName: { type: 'string' },
        outputPngPath: { type: 'string' },
      },
      required: ['action', 'projectPath'],
    },
  },
];
