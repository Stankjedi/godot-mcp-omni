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
];
