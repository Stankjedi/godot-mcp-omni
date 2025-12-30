import type { ToolDefinition } from './tool_definition.js';

export const MACRO_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'macro_manager',
    description:
      'Sequential automation macros for scaffolding game systems (reinforce plan) and optionally running the pixel pipeline via pixel_manager.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list_macros',
            'describe_macro',
            'plan',
            'run',
            'resume',
            'manifest_get',
            'validate',
          ],
        },
        projectPath: {
          type: 'string',
          description:
            'Path to the Godot project (required for all actions except list_macros).',
        },
        macroId: { type: 'string', description: 'Macro identifier' },
        macros: {
          type: 'array',
          description:
            'List of macros to run/plan (strings or objects like { macroId })',
          items: { anyOf: [{ type: 'string' }, { type: 'object' }] },
        },
        dryRun: {
          type: 'boolean',
          description: 'Plan only; do not apply changes',
        },
        forceRegenerate: {
          type: 'boolean',
          description:
            'Allow overwriting existing outputs (requires ALLOW_DANGEROUS_OPS=true).',
        },
        validate: {
          type: 'boolean',
          description:
            'When action=run: validate created scenes with validate_scene (headless). When action=validate: this field is ignored; use scenes[].',
        },
        scenes: {
          type: 'array',
          description:
            'When action=validate: list of scenes to validate (res://...)',
          items: { type: 'string' },
        },
        pixel: {
          type: 'object',
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
        },
        composeMainScene: {
          type: 'boolean',
          description:
            'When action=run: create a Main scene that instances the pixel world + macro-generated scenes (requires pixel + player/camera/input outputs).',
        },
        mainScenePath: {
          type: 'string',
          description:
            'Optional: output path for the composed Main scene (default: res://scenes/generated/macro/Main.tscn)',
        },
      },
      required: ['action'],
    },
  },
];
