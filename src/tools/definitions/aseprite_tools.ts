import type { ToolDefinition } from './tool_definition.js';

export const ASEPRITE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'aseprite_doctor',
    description:
      'Check whether Aseprite CLI is available and report supported flags.',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', description: 'Optional: help timeout' },
      },
    },
  },
  {
    name: 'aseprite_export_spritesheet',
    description:
      'Export an .aseprite file to a spritesheet PNG (and optional JSON) using Aseprite CLI.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        inputPath: {
          type: 'string',
          description:
            'Input .aseprite path (res://... or relative to project)',
        },
        outputPngPath: {
          type: 'string',
          description:
            'Output PNG path (res://... or relative to project; must be inside project)',
        },
        outputJsonPath: {
          type: 'string',
          description:
            'Optional output JSON path (res://... or relative to project; must be inside project)',
        },
        timeoutMs: { type: 'number', description: 'Optional: export timeout' },
      },
      required: ['projectPath', 'inputPath', 'outputPngPath'],
    },
  },
  {
    name: 'aseprite_manager',
    description:
      'Unified Aseprite CLI tool (multi-action; safe path mapping to res://; enforces A_ prefix for outputs).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'doctor',
            'version',
            'list_tags',
            'list_layers',
            'list_slices',
            'export_sprite',
            'export_sheet',
            'export_sheets_by_tags',
            'apply_palette_and_export',
            'scale_and_export',
            'convert_color_mode',
            'batch',
            'export_sheet_and_reimport',
            'export_sheets_by_tags_and_reimport',
          ],
        },
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project directory',
        },
        inputFile: {
          type: 'string',
          description:
            'Input .aseprite path (res://... or absolute or relative-to-project)',
        },
        hierarchy: {
          type: 'boolean',
          description:
            'When action=list_layers: if true, list layer hierarchy.',
        },
        output: {
          type: 'object',
          description: 'Output naming rules (A_ prefix is always enforced).',
          properties: {
            outputDir: { type: 'string' },
            baseName: { type: 'string' },
            overwrite: { type: 'boolean' },
          },
        },
        sheet: { type: 'object' },
        tags: { anyOf: [{ type: 'string' }, { type: 'array' }] },
        export: { type: 'object' },
        palettes: { type: 'array', items: { type: 'string' } },
        scale: { type: 'number' },
        colorMode: { type: 'string' },
        dithering: { type: 'object' },
        maxParallelJobs: { type: 'number' },
        continueOnError: { type: 'boolean' },
        jobs: { type: 'array', items: { type: 'object' } },
        reimport: { type: 'object' },
        options: {
          type: 'object',
          properties: {
            preview: { type: 'boolean' },
            verbose: { type: 'boolean' },
            timeoutMs: { type: 'number' },
          },
        },
      },
      required: ['action'],
    },
  },
];
