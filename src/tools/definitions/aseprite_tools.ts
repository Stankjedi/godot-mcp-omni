import type { ToolDefinition } from './tool_definition.js';
import {
  actionOneOfSchema,
  looseObjectSchema,
  strictObjectSchema,
} from './schema.js';

export const ASEPRITE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'aseprite_manager',
    description:
      'Unified Aseprite CLI tool (multi-action; safe path mapping to res://; enforces A_ prefix for outputs).',
    inputSchema: {
      ...(() => {
        const props = {
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
          output: strictObjectSchema({
            description: 'Output naming rules (A_ prefix is always enforced).',
            properties: {
              outputDir: { type: 'string' },
              baseName: { type: 'string' },
              overwrite: { type: 'boolean' },
            },
          }),
          sheet: looseObjectSchema({ description: 'Spritesheet config.' }),
          tags: { anyOf: [{ type: 'string' }, { type: 'array' }] },
          export: looseObjectSchema({ description: 'Export config.' }),
          palettes: { type: 'array', items: { type: 'string' } },
          scale: { type: 'number' },
          colorMode: { type: 'string' },
          dithering: looseObjectSchema({ description: 'Dithering options.' }),
          maxParallelJobs: { type: 'number' },
          continueOnError: { type: 'boolean' },
          jobs: {
            type: 'array',
            items: looseObjectSchema({ description: 'Batch job objects.' }),
          },
          reimport: looseObjectSchema({
            description: 'Godot reimport options.',
          }),
          options: strictObjectSchema({
            properties: {
              preview: { type: 'boolean' },
              verbose: { type: 'boolean' },
              timeoutMs: { type: 'number' },
            },
          }),
        };

        const commonOptional = [
          'options',
          'maxParallelJobs',
          'continueOnError',
        ];

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional,
          variants: [
            { action: 'doctor', required: [], optional: [] },
            { action: 'version', required: [], optional: [] },
            {
              action: 'list_tags',
              required: ['projectPath', 'inputFile'],
              optional: [],
            },
            {
              action: 'list_layers',
              required: ['projectPath', 'inputFile'],
              optional: ['hierarchy'],
            },
            {
              action: 'list_slices',
              required: ['projectPath', 'inputFile'],
              optional: [],
            },
            {
              action: 'export_sprite',
              required: ['projectPath', 'inputFile'],
              optional: ['output', 'export'],
            },
            {
              action: 'export_sheet',
              required: ['projectPath', 'inputFile'],
              optional: ['output', 'sheet', 'export'],
            },
            {
              action: 'export_sheets_by_tags',
              required: ['projectPath', 'inputFile'],
              optional: ['output', 'sheet', 'tags', 'export'],
            },
            {
              action: 'apply_palette_and_export',
              required: ['projectPath', 'inputFile'],
              optional: ['output', 'export', 'palettes', 'dithering'],
            },
            {
              action: 'scale_and_export',
              required: ['projectPath', 'inputFile'],
              optional: ['output', 'export', 'scale'],
            },
            {
              action: 'convert_color_mode',
              required: ['projectPath', 'inputFile'],
              optional: ['output', 'export', 'colorMode'],
            },
            {
              action: 'export_sheet_and_reimport',
              required: ['projectPath', 'inputFile'],
              optional: ['output', 'sheet', 'export', 'reimport'],
            },
            {
              action: 'export_sheets_by_tags_and_reimport',
              required: ['projectPath', 'inputFile'],
              optional: ['output', 'sheet', 'tags', 'export', 'reimport'],
            },
            {
              action: 'batch',
              required: ['projectPath', 'jobs'],
              optional: [],
            },
          ],
        });
      })(),
    },
    annotations: { destructiveHint: true },
  },
];
