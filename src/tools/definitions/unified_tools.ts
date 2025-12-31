import type { ToolDefinition } from './tool_definition.js';

export const UNIFIED_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'godot_scene_manager',
    description:
      'Unified scene/node editing tool (multi-action; uses editor bridge when connected, otherwise headless when possible).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'create',
            'update',
            'batch_create',
            'create_tilemap',
            'create_ui',
            'attach_script',
            'attach_components',
            'duplicate',
            'reparent',
            'instance',
            'remove',
            'undo',
            'redo',
          ],
        },
        projectPath: {
          type: 'string',
          description: 'Required for headless create',
        },
        scenePath: {
          type: 'string',
          description: 'Required for headless create',
        },
        nodeType: { type: 'string' },
        nodeName: { type: 'string' },
        parentNodePath: { type: 'string' },
        nodePath: { type: 'string' },
        dimension: { type: 'string', description: 'Optional: 2d or 3d' },
        newName: { type: 'string' },
        newParentPath: { type: 'string' },
        index: { type: 'number' },
        props: { type: 'object' },
        properties: { type: 'object' },
        autoAttach: { type: 'boolean' },
        ensureUniqueName: { type: 'boolean' },
        ensureChildUniqueName: { type: 'boolean' },
        primitive: { type: 'string' },
        meshPreset: { type: 'string' },
        shapePreset: { type: 'string' },
        collisionLayer: { type: 'number' },
        collisionMask: { type: 'number' },
        collisionLayerBits: {
          type: 'array',
          items: { anyOf: [{ type: 'number' }, { type: 'boolean' }] },
        },
        collisionMaskBits: {
          type: 'array',
          items: { anyOf: [{ type: 'number' }, { type: 'boolean' }] },
        },
        autoImport: { type: 'boolean' },
        autoLoadTexture: { type: 'boolean' },
        mesh: { type: 'object' },
        shape: { type: 'object' },
        sprite: { type: 'object' },
        texture: { type: 'string' },
        texturePath: { type: 'string' },
        meshNodeType: { type: 'string' },
        meshNodeName: { type: 'string' },
        shapeNodeType: { type: 'string' },
        shapeNodeName: { type: 'string' },
        spriteNodeType: { type: 'string' },
        spriteNodeName: { type: 'string' },
        meshProps: { type: 'object' },
        shapeProps: { type: 'object' },
        spriteProps: { type: 'object' },
        // batch_create / attach_components
        items: { type: 'array', items: { type: 'object' } },
        components: { type: 'array', items: { type: 'object' } },
        stopOnError: { type: 'boolean' },
        // instance (headless)
        instanceScenePath: { type: 'string' },
        sourceScenePath: { type: 'string' },
        // create_tilemap
        tileSet: { type: 'object' },
        tileSetTexturePath: { type: 'string' },
        tileSetPath: { type: 'string' },
        tileSize: { type: 'object' },
        cells: { type: 'array', items: { type: 'object' } },
        layer: { type: 'number' },
        // create_ui
        uiRootType: { type: 'string' },
        uiRootName: { type: 'string' },
        uiControlType: { type: 'string' },
        uiControlName: { type: 'string' },
        uiRootProps: { type: 'object' },
        uiControlProps: { type: 'object' },
        elements: { type: 'array', items: { type: 'object' } },
        // attach_script
        script: { type: 'object' },
        scriptPath: { type: 'string' },
        captureViewport: { type: 'boolean' },
        preview: { type: 'boolean' },
        maxSize: { type: 'number' },
        previewMaxSize: { type: 'number' },
        timeoutMs: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'godot_inspector_manager',
    description:
      'Unified inspector/query tool (multi-action; uses editor bridge; connect_signal supports headless fallback when projectPath+scenePath provided).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'query',
            'inspect',
            'select',
            'connect_signal',
            'disconnect_signal',
            'property_list',
          ],
        },
        // Common editor args
        timeoutMs: { type: 'number' },
        // query
        name: { type: 'string' },
        nameContains: { type: 'string' },
        className: { type: 'string' },
        group: { type: 'string' },
        includeRoot: { type: 'boolean' },
        limit: { type: 'number' },
        // inspect/property_list
        query_json: { anyOf: [{ type: 'object' }, { type: 'string' }] },
        nodePath: { type: 'string' },
        instanceId: { anyOf: [{ type: 'number' }, { type: 'string' }] },
        // select
        additive: { type: 'boolean' },
        clear: { type: 'boolean' },
        // signals
        fromNodePath: { type: 'string' },
        toNodePath: { type: 'string' },
        signal: { type: 'string' },
        method: { type: 'string' },
        // headless fallback for connect_signal
        projectPath: { type: 'string' },
        scenePath: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'godot_asset_manager',
    description:
      'Unified asset/resource tool (multi-action; combines UID, headless load_texture, and editor filesystem scan/reimport with headless import fallback).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'load_texture',
            'get_uid',
            'scan',
            'reimport',
            'auto_import_check',
          ],
        },
        projectPath: { type: 'string' },
        // load_texture (headless load_sprite wrapper)
        scenePath: { type: 'string' },
        nodePath: { type: 'string' },
        texturePath: { type: 'string' },
        // get_uid
        filePath: { type: 'string' },
        // scan/reimport
        files: { type: 'array', items: { type: 'string' } },
        paths: { type: 'array', items: { type: 'string' } },
        forceReimport: { type: 'boolean' },
      },
      required: ['action'],
    },
  },
  {
    name: 'godot_workspace_manager',
    description:
      'Unified workspace tool (multi-action; launches/connects editor, runs/stops/restarts via editor when connected otherwise headless run_project).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'launch',
            'connect',
            'status',
            'run',
            'stop',
            'smoke_test',
            'open_scene',
            'save_all',
            'restart',
            'doctor_report',
          ],
        },
        mode: {
          type: 'string',
          description: 'Optional: "auto" (default) or "headless"',
        },
        projectPath: { type: 'string' },
        godotPath: { type: 'string' },
        token: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number' },
        timeoutMs: { type: 'number' },
        scene: { type: 'string' },
        scenePath: { type: 'string' },
        waitMs: { type: 'number' },
        failOnIssues: {
          type: 'boolean',
          description:
            'When action=smoke_test: if true (default), returns ok=false when error-like output is detected.',
        },
        reportRelativePath: {
          type: 'string',
          description:
            'When action=doctor_report: path under project root (default: .godot_mcp/reports/doctor_report.md).',
        },
        options: {
          type: 'object',
          description:
            'When action=doctor_report: scan options (all optional; defaults are conservative).',
          properties: {
            includeAssets: { type: 'boolean', default: true },
            includeScripts: { type: 'boolean', default: true },
            includeScenes: { type: 'boolean', default: true },
            includeUID: { type: 'boolean', default: true },
            includeExport: { type: 'boolean', default: false },
            maxIssuesPerCategory: { type: 'number', default: 200 },
            timeBudgetMs: { type: 'number', default: 180000 },
            deepSceneInstantiate: { type: 'boolean', default: false },
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'godot_log_manager',
    description:
      'Read/poll Godot editor logs for error-like lines (requires editor bridge).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['poll', 'tail'] },
        cursor: {
          type: 'number',
          description:
            'When action=poll: file offset cursor returned by the previous call. When action=tail: defaults to -maxBytes (read from end).',
        },
        maxBytes: {
          type: 'number',
          description: 'Maximum bytes to read per call (default: 65536).',
        },
        maxMatches: {
          type: 'number',
          description:
            'Maximum number of lines to return after filtering (default: 50).',
        },
        onlyErrors: {
          type: 'boolean',
          description:
            'If true (default), return only error-like lines (or pattern matches).',
        },
        pattern: {
          type: 'string',
          description:
            'Optional regex (case-insensitive) used instead of the default error-like filter.',
        },
        openScriptOnError: {
          type: 'boolean',
          description:
            'If true, opens the first parsed script error in the editor (best-effort).',
        },
        timeoutMs: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'godot_editor_view_manager',
    description:
      'Unified editor UI tool (multi-action; requires editor bridge).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'capture_viewport',
            'switch_screen',
            'edit_script',
            'add_breakpoint',
          ],
        },
        timeoutMs: { type: 'number' },
        maxSize: { type: 'number' },
        savePath: {
          type: 'string',
          description: 'Optional: Local path to save the captured PNG',
        },
        screenName: { type: 'string' },
        scriptPath: { type: 'string' },
        lineNumber: { type: 'number' },
      },
      required: ['action'],
    },
  },
];
