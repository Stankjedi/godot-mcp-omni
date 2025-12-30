import type { ToolDefinition } from './tool_definition.js';

export const PIXEL_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'pixel_project_analyze',
    description: 'Analyze a Godot project for a 2D pixel pipeline profile.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'pixel_goal_to_spec',
    description:
      'Convert a natural-language goal to a validated pixel pipeline plan + derived specs (optional external HTTP adapter).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
        goal: {
          type: 'string',
          description: 'Natural language goal to convert',
        },
        allowExternalTools: {
          type: 'boolean',
          description:
            'Allow external tools (required for HTTP spec generation; requires ALLOW_EXTERNAL_TOOLS=true)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional: spec generation timeout (default: 30000)',
        },
      },
      required: ['projectPath', 'goal'],
    },
  },
  {
    name: 'pixel_tilemap_generate',
    description:
      'Generate a pixel tile sheet + TileSet resource (optional external tools).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
        spec: {
          type: 'object',
          description: 'TilemapSpec-like object',
          properties: {
            name: { type: 'string' },
            theme: { type: 'string' },
            sourceAsepritePath: {
              type: 'string',
              description:
                'Optional: .aseprite path to export (requires allowExternalTools + ALLOW_EXTERNAL_TOOLS=true)',
            },
            tileSize: { type: 'number' },
            sheet: { type: 'object' },
            output: { type: 'object' },
          },
          required: ['name'],
        },
        forceRegenerate: {
          type: 'boolean',
          description:
            'Overwrite existing outputs (requires ALLOW_DANGEROUS_OPS=true)',
        },
        reuseExistingSheet: {
          type: 'boolean',
          description:
            'When outputs exist, reuse an existing sheet PNG instead of failing (unless forceRegenerate=true).',
        },
        imageGenMode: {
          type: 'string',
          description:
            'Optional: "manual_drop" to require the sheet PNG to already exist (no placeholder generation).',
        },
        allowExternalTools: {
          type: 'boolean',
          description: 'Allow external tools like Aseprite/image generation',
        },
      },
      required: ['projectPath', 'spec'],
    },
  },
  {
    name: 'pixel_world_generate',
    description:
      'Create/update a layered TileMapLayer-based world scene from a TileSet.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
        spec: {
          type: 'object',
          description: 'WorldSpec-like object',
          properties: {
            scenePath: { type: 'string' },
            tilesetPath: { type: 'string' },
            tilesetName: { type: 'string' },
            mapSize: { type: 'object' },
            seed: { type: 'number' },
            biomes: { type: 'array' },
            layers: { type: 'array' },
            placementRules: { type: 'object' },
            organizeExisting: {
              type: 'boolean',
              description:
                'Re-parent existing TileMapLayer nodes into TileLayers/ (default: true)',
            },
          },
        },
        forceRegenerate: {
          type: 'boolean',
          description:
            'Overwrite existing outputs (requires ALLOW_DANGEROUS_OPS=true)',
        },
      },
      required: ['projectPath', 'spec'],
    },
  },
  {
    name: 'pixel_layer_ensure',
    description:
      'Ensure a TileMapLayer-based world scene has the requested layer nodes (no tile generation).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
        spec: {
          type: 'object',
          description: 'World layer spec',
          properties: {
            scenePath: { type: 'string' },
            tilesetPath: { type: 'string' },
            tilesetName: { type: 'string' },
            layers: { type: 'array' },
            organizeExisting: {
              type: 'boolean',
              description:
                'Re-parent existing TileMapLayer nodes into TileLayers/ (default: true)',
            },
          },
        },
      },
      required: ['projectPath', 'spec'],
    },
  },
  {
    name: 'pixel_object_generate',
    description: 'Generate pixel objects (sprites/scenes) for later placement.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
        spec: {
          type: 'object',
          description:
            'ObjectSpec-like object (supports objects[].placement rules and optional objects[].asepritePath)',
        },
        imageGenMode: {
          type: 'string',
          description:
            'Optional: "manual_drop" to require the sprite PNG to already exist when objects[].asepritePath is omitted.',
        },
        allowExternalTools: { type: 'boolean' },
        forceRegenerate: {
          type: 'boolean',
          description:
            'Overwrite existing outputs (requires ALLOW_DANGEROUS_OPS=true)',
        },
      },
      required: ['projectPath', 'spec'],
    },
  },
  {
    name: 'pixel_object_place',
    description: 'Place generated objects into a world scene.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
        worldScenePath: { type: 'string' },
        spec: { type: 'object', description: 'ObjectSpec-like object' },
        seed: { type: 'number' },
      },
      required: ['projectPath', 'worldScenePath', 'spec'],
    },
  },
  {
    name: 'pixel_smoke_test',
    description:
      'Run a short headless smoke test (run -> wait -> stop) and report error-like lines.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
        scenePath: {
          type: 'string',
          description:
            'Optional scene path to run (defaults to manifest world scene if present)',
        },
        headless: {
          type: 'boolean',
          description: 'Run in headless mode (default: true)',
        },
        waitMs: {
          type: 'number',
          description: 'How long to wait before stopping (default: 1500)',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'pixel_export_preview',
    description:
      'Export a lightweight PNG preview of a TileMapLayer (debug tile distribution image).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
        scenePath: {
          type: 'string',
          description:
            'Optional world scene path (defaults to manifest world scene if present)',
        },
        layerName: {
          type: 'string',
          description: 'TileMapLayer node name (default: Terrain)',
        },
        outputPngPath: {
          type: 'string',
          description:
            'Output PNG path inside the project (default: res://.godot_mcp/previews/pixel_preview.png)',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'pixel_macro_run',
    description:
      'Run a multi-step pixel pipeline macro (tilemap -> world -> objects).',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
        goal: {
          type: 'string',
          description: 'Natural language goal (optional)',
        },
        plan: {
          type: 'array',
          description: 'Optional structured steps',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: 'Tool name (pixel_*)' },
              args: { type: 'object', description: 'Tool arguments' },
            },
            required: ['tool'],
          },
        },
        dryRun: { type: 'boolean' },
        failFast: { type: 'boolean' },
        seed: { type: 'number' },
        forceRegenerate: { type: 'boolean' },
        allowExternalTools: { type: 'boolean' },
        specGenTimeoutMs: {
          type: 'number',
          description:
            'Optional: HTTP spec generator timeout (ms) when SPEC_GEN_URL is used (default: 30000)',
        },
        exportPreview: {
          type: 'boolean',
          description: 'Append pixel_export_preview at the end (optional)',
        },
        smokeTest: {
          type: 'boolean',
          description: 'Append pixel_smoke_test at the end (optional)',
        },
        smokeWaitMs: { type: 'number', description: 'Smoke test wait time' },
        previewOutputPngPath: {
          type: 'string',
          description: 'Optional preview output path (when exportPreview=true)',
        },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'pixel_manifest_get',
    description: 'Get the latest pixel pipeline manifest for a project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to the Godot project',
        },
      },
      required: ['projectPath'],
    },
  },
];
