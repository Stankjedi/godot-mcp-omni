import type { ToolDefinition } from './tool_definition.js';
import {
  actionOneOfSchema,
  looseObjectSchema,
  strictObjectSchema,
} from './schema.js';

export const UNIFIED_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'godot_scene_manager',
    description:
      'Unified scene/node editing tool (multi-action; uses editor bridge when connected, otherwise headless when possible).',
    inputSchema: {
      ...(() => {
        const props = {
          timeoutMs: { type: 'number' },
          projectPath: {
            type: 'string',
            description: 'Required for headless edits when not connected.',
          },
          scenePath: {
            type: 'string',
            description: 'Required for headless edits when not connected.',
          },
          nodeType: { type: 'string' },
          nodeName: { type: 'string' },
          name: { type: 'string' },
          parentNodePath: { type: 'string' },
          nodePath: { type: 'string' },
          dimension: { type: 'string', description: 'Optional: 2d or 3d' },
          newName: { type: 'string' },
          newParentPath: { type: 'string' },
          index: { type: 'number' },
          props: looseObjectSchema({
            description: 'Dynamic Godot property map (keys vary by node type).',
          }),
          properties: looseObjectSchema({
            description: 'Alias of props (dynamic Godot property map).',
          }),
          autoAttach: { type: 'boolean' },
          ensureUniqueName: { type: 'boolean' },
          ensureChildUniqueName: { type: 'boolean' },
          primitive: { type: 'string' },
          meshPreset: { type: 'string' },
          shapePreset: { type: 'string' },
          collisionLayer: { type: 'number' },
          collisionMask: { type: 'number' },
          bus: { type: 'string' },
          autoplay: { type: 'boolean' },
          cameraHeight: { type: 'number' },
          capsuleRadius: { type: 'number' },
          capsuleHeight: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          pickupScenePath: { type: 'string' },
          preset: { type: 'string' },
          is3d: { type: 'boolean' },
          oneShot: { type: 'boolean' },
          emitting: { type: 'boolean' },
          size: { type: 'number' },
          shaderPath: { type: 'string' },
          type: { type: 'string' },
          textureScale: { type: 'number' },
          blendSharpness: { type: 'number' },
          heightLevels: { type: 'string' },
          left: { type: 'number' },
          top: { type: 'number' },
          right: { type: 'number' },
          bottom: { type: 'number' },
          anchorLeft: { type: 'number' },
          anchorTop: { type: 'number' },
          anchorRight: { type: 'number' },
          anchorBottom: { type: 'number' },
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
          mesh: looseObjectSchema({
            description: 'Optional: mesh ResourceSpec.',
          }),
          shape: looseObjectSchema({
            description: 'Optional: collision shape ResourceSpec.',
          }),
          sprite: looseObjectSchema({
            description: 'Optional: sprite/texture ResourceSpec.',
          }),
          texture: { type: 'string' },
          texturePath: { type: 'string' },
          meshNodeType: { type: 'string' },
          meshNodeName: { type: 'string' },
          shapeNodeType: { type: 'string' },
          shapeNodeName: { type: 'string' },
          spriteNodeType: { type: 'string' },
          spriteNodeName: { type: 'string' },
          meshProps: looseObjectSchema({
            description: 'Dynamic property map.',
          }),
          shapeProps: looseObjectSchema({
            description: 'Dynamic property map.',
          }),
          spriteProps: looseObjectSchema({
            description: 'Dynamic property map.',
          }),
          items: {
            type: 'array',
            items: looseObjectSchema({ description: 'batch_create items.' }),
          },
          components: {
            type: 'array',
            items: looseObjectSchema({
              description: 'attach_components items.',
            }),
          },
          stopOnError: { type: 'boolean' },
          instanceScenePath: { type: 'string' },
          sourceScenePath: { type: 'string' },
          tileSet: looseObjectSchema({
            description: 'Optional: TileSet ResourceSpec.',
          }),
          tileSetTexturePath: { type: 'string' },
          tileSetPath: { type: 'string' },
          tileSize: looseObjectSchema({
            description: 'Vector2i-like (tile size).',
          }),
          cells: {
            type: 'array',
            items: looseObjectSchema({ description: 'Tile cell objects.' }),
          },
          layer: { type: 'number' },
          uiRootType: { type: 'string' },
          uiRootName: { type: 'string' },
          uiControlType: { type: 'string' },
          uiControlName: { type: 'string' },
          uiRootProps: looseObjectSchema({
            description: 'Dynamic property map.',
          }),
          uiControlProps: looseObjectSchema({
            description: 'Dynamic property map.',
          }),
          elements: {
            type: 'array',
            items: looseObjectSchema({ description: 'UI element objects.' }),
          },
          script: looseObjectSchema({
            description: 'Optional: script ResourceSpec.',
          }),
          scriptPath: { type: 'string' },
          captureViewport: { type: 'boolean' },
          preview: { type: 'boolean' },
          maxSize: { type: 'number' },
          previewMaxSize: { type: 'number' },
        };

        const commonOptional = [
          'timeoutMs',
          'projectPath',
          'scenePath',
          'captureViewport',
          'preview',
          'maxSize',
          'previewMaxSize',
        ];

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional,
          variants: [
            {
              action: 'create',
              required: ['nodeType', 'nodeName'],
              optional: [
                'parentNodePath',
                'dimension',
                'props',
                'properties',
                'autoAttach',
                'ensureUniqueName',
                'ensureChildUniqueName',
                'primitive',
                'meshPreset',
                'shapePreset',
                'collisionLayer',
                'collisionMask',
                'collisionLayerBits',
                'collisionMaskBits',
                'autoImport',
                'autoLoadTexture',
                'mesh',
                'shape',
                'sprite',
                'texture',
                'texturePath',
                'meshNodeType',
                'meshNodeName',
                'shapeNodeType',
                'shapeNodeName',
                'spriteNodeType',
                'spriteNodeName',
                'meshProps',
                'shapeProps',
                'spriteProps',
              ],
            },
            {
              action: 'update',
              required: ['nodePath'],
              optional: [
                'props',
                'properties',
                'mesh',
                'shape',
                'sprite',
                'texture',
                'texturePath',
                'collisionLayer',
                'collisionMask',
                'collisionLayerBits',
                'collisionMaskBits',
                'script',
                'scriptPath',
              ],
            },
            {
              action: 'batch_create',
              required: ['items'],
              optional: ['stopOnError'],
            },
            {
              action: 'create_tilemap',
              required: ['nodeName'],
              optional: [
                'nodeType',
                'parentNodePath',
                'props',
                'properties',
                'tileSet',
                'tileSetTexturePath',
                'tileSetPath',
                'tileSize',
                'cells',
                'layer',
                'ensureUniqueName',
              ],
            },
            {
              action: 'create_ui',
              required: [],
              optional: [
                'parentNodePath',
                'uiRootType',
                'uiRootName',
                'uiControlType',
                'uiControlName',
                'uiRootProps',
                'uiControlProps',
                'elements',
                'ensureUniqueName',
              ],
            },
            {
              action: 'attach_script',
              required: ['nodePath', 'scriptPath'],
              optional: ['script'],
            },
            {
              action: 'attach_components',
              required: ['nodePath', 'components'],
              optional: ['ensureUniqueName', 'ensureChildUniqueName'],
            },
            {
              action: 'rename',
              required: ['nodePath', 'newName'],
              optional: ['ensureUniqueName'],
            },
            {
              action: 'move',
              required: ['nodePath', 'index'],
              optional: [],
            },
            {
              action: 'duplicate',
              required: ['nodePath'],
              optional: ['newName'],
            },
            {
              action: 'reparent',
              required: ['nodePath', 'newParentPath'],
              optional: ['index'],
            },
            {
              action: 'instance',
              required: ['scenePath'],
              optional: [
                'instanceScenePath',
                'parentNodePath',
                'name',
                'props',
                'ensureUniqueName',
              ],
            },
            {
              action: 'remove',
              required: ['nodePath'],
              optional: [],
            },
            { action: 'undo', required: [], optional: [] },
            { action: 'redo', required: [], optional: [] },
          ],
        });
      })(),
    },
    annotations: { destructiveHint: true, headlessHint: true },
  },
  {
    name: 'godot_inspector_manager',
    description:
      'Unified inspector/query tool (multi-action; uses editor bridge; connect_signal supports headless fallback when projectPath+scenePath provided).',
    inputSchema: {
      ...(() => {
        const props = {
          timeoutMs: { type: 'number' },
          name: { type: 'string' },
          nameContains: { type: 'string' },
          className: { type: 'string' },
          group: { type: 'string' },
          includeRoot: { type: 'boolean' },
          limit: { type: 'number' },
          query_json: { anyOf: [{ type: 'object' }, { type: 'string' }] },
          nodePath: { type: 'string' },
          instanceId: { anyOf: [{ type: 'number' }, { type: 'string' }] },
          additive: { type: 'boolean' },
          clear: { type: 'boolean' },
          fromNodePath: { type: 'string' },
          toNodePath: { type: 'string' },
          signal: { type: 'string' },
          method: { type: 'string' },
          sourceNodePath: { type: 'string' },
          groupName: { type: 'string' },
          playerPath: { type: 'string' },
          animation: { type: 'string' },
          startTime: { type: 'number' },
          backwards: { type: 'boolean' },
          startValue: { description: 'JSON-serializable value.' },
          endValue: { description: 'JSON-serializable value.' },
          duration: { type: 'number' },
          replaceExisting: { type: 'boolean' },
          bus: { type: 'string' },
          volumeDb: { type: 'number' },
          param: { type: 'string' },
          materialProperty: { type: 'string' },
          surfaceIndex: { type: 'number' },
          projectPath: { type: 'string' },
          scenePath: { type: 'string' },
          property: { type: 'string' },
          value: { description: 'JSON-serializable value.' },
          resourceType: {
            type: 'string',
            description:
              'When action=resource.add: Resource class name (ex: Environment) or resource path.',
          },
          resourcePath: {
            type: 'string',
            description:
              'When action=resource.add: optional save path for newly created resources (ex: res://my_resource.tres).',
          },
          props: {
            type: 'object',
            description: 'When action=resource.add: resource properties.',
          },
          properties: {
            type: 'object',
            description: 'Alias of props (When action=resource.add).',
          },
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
        };

        const exclusiveOneOf = (keys: string[]): Record<string, unknown> => ({
          oneOf: keys.map((key) => ({
            required: [key],
            not: {
              anyOf: keys
                .filter((k) => k !== key)
                .map((k) => ({
                  required: [k],
                })),
            },
          })),
        });

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional: ['timeoutMs', 'projectPath', 'scenePath'],
          variants: [
            {
              action: 'query',
              required: [],
              optional: [
                'name',
                'nameContains',
                'className',
                'group',
                'includeRoot',
                'limit',
              ],
            },
            {
              action: 'scene_tree.get',
              required: [],
              optional: ['limit'],
            },
            {
              action: 'inspect',
              required: [],
              optional: ['query_json', 'className', 'nodePath', 'instanceId'],
              oneOf: [
                exclusiveOneOf([
                  'query_json',
                  'className',
                  'nodePath',
                  'instanceId',
                ]),
              ],
            },
            {
              action: 'property_list',
              required: [],
              optional: ['className', 'nodePath', 'instanceId'],
              oneOf: [exclusiveOneOf(['className', 'nodePath', 'instanceId'])],
            },
            {
              action: 'select',
              required: [],
              optional: ['nodePath', 'instanceId', 'additive', 'clear'],
            },
            {
              action: 'connect_signal',
              required: ['fromNodePath', 'signal', 'toNodePath', 'method'],
              optional: [],
            },
            {
              action: 'disconnect_signal',
              required: ['fromNodePath', 'signal', 'toNodePath', 'method'],
              optional: [],
            },
            {
              action: 'resource.add',
              required: ['nodePath', 'property', 'resourceType'],
              optional: ['resourcePath', 'props', 'properties'],
            },
            {
              action: 'set_property',
              required: ['nodePath', 'property', 'value'],
              optional: [],
            },
            {
              action: 'get_property',
              required: ['nodePath', 'property'],
              optional: [],
            },
            { action: 'get_selection', required: [], optional: [] },
            {
              action: 'method_list',
              required: [],
              optional: ['className', 'nodePath', 'instanceId'],
              oneOf: [exclusiveOneOf(['className', 'nodePath', 'instanceId'])],
            },
            {
              action: 'signals.list',
              required: [],
              optional: ['className', 'nodePath', 'instanceId'],
              oneOf: [exclusiveOneOf(['className', 'nodePath', 'instanceId'])],
            },
            {
              action: 'signals.connections.list',
              required: ['sourceNodePath'],
              optional: ['signal'],
            },
            { action: 'groups.get', required: ['nodePath'], optional: [] },
            {
              action: 'groups.add',
              required: ['nodePath', 'groupName'],
              optional: [],
            },
            {
              action: 'groups.remove',
              required: ['nodePath', 'groupName'],
              optional: [],
            },
            {
              action: 'animation.list',
              required: ['playerPath'],
              optional: [],
            },
            {
              action: 'animation.play',
              required: ['playerPath', 'animation'],
              optional: ['startTime', 'backwards'],
            },
            {
              action: 'animation.stop',
              required: ['playerPath'],
              optional: [],
            },
            {
              action: 'animation.seek',
              required: ['playerPath', 'startTime'],
              optional: [],
            },
            {
              action: 'animation.create_simple',
              required: [
                'playerPath',
                'animation',
                'nodePath',
                'property',
                'endValue',
              ],
              optional: ['startValue', 'duration', 'replaceExisting'],
            },
            { action: 'audio.play', required: ['nodePath'], optional: [] },
            { action: 'audio.stop', required: ['nodePath'], optional: [] },
            {
              action: 'audio.set_bus_volume',
              required: ['bus', 'volumeDb'],
              optional: [],
            },
            { action: 'focus_node', required: ['nodePath'], optional: [] },
            {
              action: 'shader.set_param',
              required: ['nodePath', 'param', 'value'],
              optional: ['materialProperty', 'surfaceIndex'],
            },
            {
              action: 'set_collision_layer',
              required: ['nodePath'],
              optional: [
                'collisionLayer',
                'collisionMask',
                'collisionLayerBits',
                'collisionMaskBits',
              ],
            },
          ],
        });
      })(),
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'godot_asset_manager',
    description:
      'Unified asset/resource tool (multi-action; combines UID, headless load_texture, and editor filesystem scan/reimport with headless import fallback).',
    inputSchema: {
      ...(() => {
        const props = {
          projectPath: { type: 'string' },
          scenePath: { type: 'string' },
          nodePath: { type: 'string' },
          texturePath: { type: 'string' },
          filePath: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          paths: { type: 'array', items: { type: 'string' } },
          forceReimport: { type: 'boolean' },
          dirPath: {
            type: 'string',
            description: 'Directory under res:// (default: res://).',
          },
          recursive: { type: 'boolean' },
          pattern: {
            type: 'string',
            description: 'Search pattern (substring or regex-like).',
          },
          maxResults: { type: 'number' },
          maxChars: { type: 'number' },
          createParents: { type: 'boolean' },
          sourceScenePath: { type: 'string' },
          destScenePath: { type: 'string' },
          newScenePath: { type: 'string' },
          oldResource: { type: 'string' },
          newResource: { type: 'string' },
        };

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional: ['projectPath'],
          variants: [
            {
              action: 'load_texture',
              required: ['projectPath', 'scenePath', 'nodePath', 'texturePath'],
              optional: [],
            },
            {
              action: 'get_uid',
              required: ['projectPath', 'filePath'],
              optional: [],
            },
            {
              action: 'uid_convert',
              required: ['projectPath', 'filePath'],
              optional: [],
            },
            { action: 'scan', required: [], optional: [] },
            {
              action: 'reimport',
              required: [],
              optional: ['files', 'paths'],
            },
            {
              action: 'auto_import_check',
              required: [],
              optional: ['files', 'paths', 'forceReimport'],
            },
            {
              action: 'file_exists',
              required: ['projectPath', 'filePath'],
              optional: [],
            },
            {
              action: 'create_folder',
              required: ['projectPath', 'dirPath'],
              optional: ['createParents'],
            },
            {
              action: 'list_resources',
              required: ['projectPath'],
              optional: ['dirPath', 'recursive', 'maxResults'],
            },
            {
              action: 'search_files',
              required: ['projectPath', 'pattern'],
              optional: ['dirPath', 'recursive', 'maxResults'],
            },
            {
              action: 'scene.read',
              required: ['projectPath'],
              optional: ['scenePath', 'maxChars'],
            },
            {
              action: 'scene.delete',
              required: ['projectPath', 'scenePath'],
              optional: [],
            },
            {
              action: 'scene.duplicate',
              required: ['projectPath', 'sourceScenePath', 'destScenePath'],
              optional: [],
            },
            {
              action: 'scene.rename',
              required: ['projectPath', 'scenePath', 'newScenePath'],
              optional: [],
            },
            {
              action: 'scene.replace_resource',
              required: [
                'projectPath',
                'scenePath',
                'oldResource',
                'newResource',
              ],
              optional: [],
            },
          ],
        });
      })(),
    },
    annotations: { destructiveHint: true, headlessHint: true },
  },
  {
    name: 'godot_builder_manager',
    description:
      'High-level builder/preset tool (multi-action; composes existing manager tools to scaffold common nodes and UI patterns).',
    inputSchema: {
      ...(() => {
        const props = {
          timeoutMs: { type: 'number' },
          projectPath: {
            type: 'string',
            description: 'Required for headless mode when not connected.',
          },
          scenePath: {
            type: 'string',
            description: 'Required for headless mode when not connected.',
          },
          parentNodePath: { type: 'string' },
          nodeName: { type: 'string' },
          dimension: { type: 'string', description: 'Optional: 2d or 3d' },
          ensureUniqueName: { type: 'boolean' },

          size: {
            type: 'number',
            description:
              'When action=generate_terrain_mesh: grid size (default: 32). When action=create_rigidbody/create_trigger_area: size parameter (defaults: 1.0; interpreted per shape).',
          },
          heightScale: {
            type: 'number',
            description:
              'When action=generate_terrain_mesh: noise height scale (default: 5.0).',
          },
          seed: {
            type: 'number',
            description:
              'When action=generate_terrain_mesh: noise seed (0 = random).',
          },
          frequency: {
            type: 'number',
            description:
              'When action=generate_terrain_mesh: noise frequency (default: 0.02).',
          },
          octaves: {
            type: 'number',
            description:
              'When action=generate_terrain_mesh: noise octaves (default: 4).',
          },
          center: {
            type: 'boolean',
            description:
              'When action=generate_terrain_mesh: center the generated terrain (default: true).',
          },

          lightingPreset: {
            type: 'string',
            enum: [
              'basic_3d',
              'basic_2d',
              'sunny',
              'overcast',
              'sunset',
              'night',
              'indoor',
            ],
            description:
              'When action=lighting_preset: preset identifier (default: basic_3d).',
          },
          includeWorldEnvironment: {
            type: 'boolean',
            description:
              'When action=lighting_preset: include a WorldEnvironment node (default: true).',
          },
          includeDirectionalLight: {
            type: 'boolean',
            description:
              'When action=lighting_preset: include a DirectionalLight node (default: true).',
          },

          bodyType: {
            type: 'string',
            description:
              'When action=create_primitive/create_rigidbody: node type to create (defaults: StaticBody3D for create_primitive, RigidBody3D for create_rigidbody).',
          },
          shape: {
            type: 'string',
            description:
              'When action=create_rigidbody/create_trigger_area: alias of shapePreset (ex: box, sphere, capsule, cylinder).',
          },
          mass: {
            type: 'number',
            description: 'When action=create_rigidbody: body mass.',
          },
          color: {
            anyOf: [
              { type: 'string' },
              looseObjectSchema({
                description:
                  'Color object (ex: { $type: "Color", r: 1, g: 0.5, b: 0.2, a: 1 }).',
              }),
            ],
            description:
              'When action=create_rigidbody: mesh color (ex: "#ffcc00" or "1,0.8,0,1").',
          },
          debugMesh: {
            type: 'boolean',
            description:
              'When action=create_trigger_area: create a DebugMesh child (default: false).',
          },
          primitive: {
            type: 'string',
            description: 'Primitive preset (ex: box, capsule).',
          },
          meshPreset: {
            type: 'string',
            description: 'Mesh preset (ex: box, sphere).',
          },
          shapePreset: {
            type: 'string',
            description: 'Collision shape preset (ex: box, capsule).',
          },
          collisionLayer: { type: 'number' },
          collisionMask: { type: 'number' },

          bus: {
            type: 'string',
            description: 'When action=create_audio_player: audio bus name.',
          },
          autoplay: {
            type: 'boolean',
            description:
              'When action=create_audio_player: autoplay (default: false).',
          },

          cameraHeight: {
            type: 'number',
            description:
              'When action=spawn_fps_controller: camera height (default: 1.6).',
          },
          capsuleRadius: {
            type: 'number',
            description:
              'When action=spawn_fps_controller: capsule radius (default: 0.3).',
          },
          capsuleHeight: {
            type: 'number',
            description:
              'When action=spawn_fps_controller: capsule height (default: 1.6).',
          },

          width: {
            type: 'number',
            description:
              'When action=create_health_bar_ui: width (default: 240).',
          },
          height: {
            type: 'number',
            description:
              'When action=create_health_bar_ui: height (default: 24).',
          },

          pickupScenePath: {
            type: 'string',
            description:
              'When action=spawn_spinning_pickup: PackedScene path to instance (default: res://Pickup.tscn).',
          },

          preset: {
            type: 'string',
            description:
              'When action=create_particle_effect: effect preset (ex: fire, smoke, sparks, explosion).',
          },
          is3d: {
            type: 'boolean',
            description:
              'When action=create_particle_effect: spawn 3D particles (default: true).',
          },
          oneShot: {
            type: 'boolean',
            description:
              'When action=create_particle_effect: one-shot mode (default: false).',
          },
          emitting: {
            type: 'boolean',
            description:
              'When action=create_particle_effect: emitting enabled (default: true).',
          },

          shaderPath: {
            type: 'string',
            description:
              'When action=create_terrain_material: output shader path (default: res://terrain_material.gdshader).',
          },
          type: {
            type: 'string',
            description:
              'When action=create_terrain_material: shader type (ex: height_blend).',
          },
          textureScale: {
            type: 'number',
            description:
              'When action=create_terrain_material: texture scale (default: 0.1).',
          },
          blendSharpness: {
            type: 'number',
            description:
              'When action=create_terrain_material: blend sharpness (default: 2.0).',
          },
          heightLevels: {
            type: 'string',
            description:
              'When action=create_terrain_material: comma-separated height levels (default: 0.0,0.3,0.6,1.0).',
          },

          uiTemplate: {
            type: 'string',
            enum: [
              'basic',
              'hud',
              'menu',
              'main_menu',
              'pause_menu',
              'dialogue_box',
              'inventory_grid',
            ],
            description:
              'When action=create_ui_template: which template to generate (default: basic).',
          },
          uiRootType: { type: 'string' },
          uiRootName: { type: 'string' },
          uiControlType: { type: 'string' },
          uiControlName: { type: 'string' },
          elements: {
            type: 'array',
            items: looseObjectSchema({ description: 'UI element objects.' }),
          },

          nodePath: {
            type: 'string',
            description:
              'When action=set_anchor_preset: target Control node path.',
          },
          anchorPreset: {
            type: 'string',
            enum: [
              'top_left',
              'top_right',
              'bottom_left',
              'bottom_right',
              'center_left',
              'center_right',
              'center_top',
              'center_bottom',
              'center',
              'left_wide',
              'right_wide',
              'top_wide',
              'bottom_wide',
              'vcenter_wide',
              'hcenter_wide',
              'full_rect',
            ],
            description:
              'When action=set_anchor_preset: anchor preset for Control nodes.',
          },
          keepOffsets: {
            type: 'boolean',
            description:
              'When action=set_anchor_preset: keep current offsets (default: false).',
          },

          left: { type: 'number' },
          top: { type: 'number' },
          right: { type: 'number' },
          bottom: { type: 'number' },
          anchorLeft: { type: 'number' },
          anchorTop: { type: 'number' },
          anchorRight: { type: 'number' },
          anchorBottom: { type: 'number' },
        };

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional: ['timeoutMs', 'projectPath', 'scenePath'],
          variants: [
            {
              action: 'lighting_preset',
              required: [],
              optional: [
                'parentNodePath',
                'lightingPreset',
                'includeWorldEnvironment',
                'includeDirectionalLight',
                'ensureUniqueName',
              ],
            },
            {
              action: 'create_primitive',
              required: ['nodeName'],
              optional: [
                'parentNodePath',
                'bodyType',
                'primitive',
                'meshPreset',
                'shapePreset',
                'collisionLayer',
                'collisionMask',
                'ensureUniqueName',
                'dimension',
              ],
            },
            {
              action: 'create_ui_template',
              required: [],
              optional: [
                'parentNodePath',
                'uiTemplate',
                'uiRootType',
                'uiRootName',
                'uiControlType',
                'uiControlName',
                'elements',
                'ensureUniqueName',
              ],
            },
            {
              action: 'create_audio_player',
              required: ['nodeName'],
              optional: [
                'parentNodePath',
                'dimension',
                'bus',
                'autoplay',
                'ensureUniqueName',
              ],
            },
            {
              action: 'spawn_fps_controller',
              required: [],
              optional: [
                'parentNodePath',
                'nodeName',
                'cameraHeight',
                'capsuleRadius',
                'capsuleHeight',
                'ensureUniqueName',
              ],
            },
            {
              action: 'create_health_bar_ui',
              required: [],
              optional: [
                'parentNodePath',
                'nodeName',
                'width',
                'height',
                'ensureUniqueName',
              ],
            },
            {
              action: 'spawn_spinning_pickup',
              required: [],
              optional: [
                'parentNodePath',
                'nodeName',
                'pickupScenePath',
                'ensureUniqueName',
              ],
            },
            {
              action: 'create_particle_effect',
              required: [],
              optional: [
                'parentNodePath',
                'nodeName',
                'preset',
                'is3d',
                'oneShot',
                'emitting',
                'ensureUniqueName',
              ],
            },
            {
              action: 'generate_terrain_mesh',
              required: [],
              optional: [
                'parentNodePath',
                'nodeName',
                'size',
                'heightScale',
                'seed',
                'frequency',
                'octaves',
                'center',
                'ensureUniqueName',
              ],
            },
            {
              action: 'create_terrain_material',
              required: ['projectPath'],
              optional: [
                'shaderPath',
                'type',
                'textureScale',
                'blendSharpness',
                'heightLevels',
              ],
            },
            {
              action: 'create_trigger_area',
              required: ['nodeName'],
              optional: [
                'parentNodePath',
                'dimension',
                'shape',
                'shapePreset',
                'size',
                'debugMesh',
                'collisionLayer',
                'collisionMask',
                'ensureUniqueName',
              ],
            },
            {
              action: 'create_rigidbody',
              required: ['nodeName'],
              optional: [
                'parentNodePath',
                'dimension',
                'bodyType',
                'shape',
                'primitive',
                'meshPreset',
                'shapePreset',
                'size',
                'mass',
                'color',
                'collisionLayer',
                'collisionMask',
                'ensureUniqueName',
              ],
            },
            {
              action: 'set_anchor_preset',
              required: ['nodePath', 'anchorPreset'],
              optional: ['keepOffsets'],
            },
            {
              action: 'set_anchor_values',
              required: ['nodePath'],
              optional: [
                'left',
                'top',
                'right',
                'bottom',
                'anchorLeft',
                'anchorTop',
                'anchorRight',
                'anchorBottom',
              ],
            },
          ],
        });
      })(),
    },
    annotations: { destructiveHint: true, headlessHint: true },
  },
  {
    name: 'godot_code_manager',
    description:
      'Unified code/file tool (multi-action; safe project-root writes; script/shader helpers; supports editor attach via scene_manager).',
    inputSchema: {
      ...(() => {
        const props = {
          projectPath: {
            type: 'string',
            description: 'Path to the Godot project directory',
          },
          timeoutMs: { type: 'number' },
          expression: {
            type: 'string',
            description:
              'When action=gdscript.eval_restricted: single-line expression to evaluate.',
          },
          code: {
            type: 'string',
            description:
              'Alias of expression (When action=gdscript.eval_restricted).',
          },
          vars: {
            type: 'object',
            description:
              'When action=gdscript.eval_restricted: optional variables map for Expression inputs.',
          },
          variables: {
            type: 'object',
            description:
              'Alias of vars (When action=gdscript.eval_restricted).',
          },

          scriptPath: {
            type: 'string',
            description: 'res:// path to a GDScript file',
          },
          shaderPath: {
            type: 'string',
            description: 'res:// path to a shader file (.gdshader)',
          },
          filePath: {
            type: 'string',
            description: 'res:// path to a file inside the project',
          },

          nodePath: {
            type: 'string',
            description: 'Target node path in the edited scene',
          },
          scenePath: {
            type: 'string',
            description:
              'Optional: required for headless script.attach when not connected.',
          },

          content: { type: 'string', description: 'File contents (UTF-8)' },
          template: {
            type: 'string',
            description:
              'Optional template name for script.create (default: basic_node).',
          },
          className: {
            type: 'string',
            description: 'Optional class_name for script templates.',
          },
          maxChars: {
            type: 'number',
            description:
              'When action=script.read: max characters to return (default: 12000).',
          },

          find: { type: 'string', description: 'Find string/regex pattern.' },
          replace: { type: 'string', description: 'Replace string.' },
          regex: {
            type: 'boolean',
            description: 'If true, treat find as a JavaScript RegExp source.',
          },
          maxReplacements: {
            type: 'number',
            description: 'Maximum replacements to apply (default: 50).',
          },
          dryRun: {
            type: 'boolean',
            description:
              'If true, do not write changes; return a preview only.',
          },

          base64: {
            type: 'string',
            description: 'Base64-encoded binary payload',
          },

          materialProperty: {
            type: 'string',
            description:
              'When action=shader.apply: material property to set (default: material_override).',
          },
        };

        const exclusiveOneOf = (keys: string[]): Record<string, unknown> => ({
          oneOf: keys.map((key) => ({
            required: [key],
            not: {
              anyOf: keys
                .filter((k) => k !== key)
                .map((k) => ({
                  required: [k],
                })),
            },
          })),
        });

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional: ['timeoutMs'],
          variants: [
            {
              action: 'script.create',
              required: ['projectPath', 'scriptPath'],
              optional: ['content', 'template', 'className'],
            },
            {
              action: 'script.read',
              required: ['projectPath', 'scriptPath'],
              optional: ['maxChars'],
            },
            {
              action: 'script.attach',
              required: ['projectPath', 'nodePath', 'scriptPath'],
              optional: ['scenePath'],
            },
            {
              action: 'gdscript.eval_restricted',
              required: ['projectPath'],
              optional: ['expression', 'code', 'vars', 'variables'],
              oneOf: [exclusiveOneOf(['expression', 'code'])],
            },
            {
              action: 'shader.create',
              required: ['projectPath', 'shaderPath'],
              optional: ['content'],
            },
            {
              action: 'shader.apply',
              required: ['projectPath', 'nodePath', 'shaderPath'],
              optional: ['materialProperty'],
            },
            {
              action: 'file.edit',
              required: ['projectPath', 'filePath', 'find', 'replace'],
              optional: ['regex', 'maxReplacements', 'dryRun'],
            },
            {
              action: 'file.write_binary',
              required: ['projectPath', 'filePath', 'base64'],
              optional: [],
            },
          ],
        });
      })(),
    },
    annotations: { destructiveHint: true, headlessHint: true },
  },
  {
    name: 'godot_project_config_manager',
    description:
      'Project configuration manager (multi-action; wraps save/load, input map, and ProjectSettings access via headless ops when needed).',
    inputSchema: {
      ...(() => {
        const props = {
          projectPath: {
            type: 'string',
            description: 'Path to the Godot project directory',
          },
          timeoutMs: { type: 'number' },

          key: {
            type: 'string',
            description:
              'Key for save/load game data or project_setting.* (ex: "player_profile").',
          },
          value: {
            description: 'Arbitrary JSON value',
            anyOf: [
              { type: 'string' },
              { type: 'number' },
              { type: 'boolean' },
              { type: 'object' },
              { type: 'array' },
              { type: 'null' },
            ],
          },
          defaultValue: {
            description: 'Optional default value when loading missing data',
            anyOf: [
              { type: 'string' },
              { type: 'number' },
              { type: 'boolean' },
              { type: 'object' },
              { type: 'array' },
              { type: 'null' },
            ],
          },
          actions: {
            type: 'array',
            description:
              'When action=input_map.setup: list of actions to configure.',
            items: strictObjectSchema({
              properties: {
                name: { type: 'string' },
                keys: {
                  type: 'array',
                  description:
                    'Keyboard keys (strings like "W" or "KEY_W", or numeric keycodes).',
                  items: { anyOf: [{ type: 'string' }, { type: 'number' }] },
                },
                deadzone: { type: 'number' },
              },
              required: ['name'],
            }),
          },
          maxMatches: {
            type: 'number',
            description:
              'When action=errors.get_recent: max lines to return (default: 50).',
          },
        };

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional: ['projectPath', 'timeoutMs'],
          variants: [
            {
              action: 'project_info.get',
              required: ['projectPath'],
              optional: [],
            },
            {
              action: 'save_game_data',
              required: ['projectPath', 'key', 'value'],
              optional: [],
            },
            {
              action: 'load_game_data',
              required: ['projectPath', 'key'],
              optional: ['defaultValue'],
            },
            {
              action: 'input_map.setup',
              required: ['projectPath', 'actions'],
              optional: [],
            },
            {
              action: 'project_setting.set',
              required: ['projectPath', 'key', 'value'],
              optional: [],
            },
            {
              action: 'project_setting.get',
              required: ['projectPath', 'key'],
              optional: [],
            },
            {
              action: 'errors.get_recent',
              required: [],
              optional: ['maxMatches'],
            },
          ],
        });
      })(),
    },
    annotations: { destructiveHint: true, headlessHint: true },
  },
  {
    name: 'godot_workspace_manager',
    description:
      'Unified workspace tool (multi-action; launches/connects editor, runs/stops/restarts via editor when connected, otherwise headless).',
    inputSchema: {
      ...(() => {
        const props = {
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
          rootNodeType: { type: 'string' },
          newPath: {
            type: 'string',
            description:
              'When action=save_scene: optional new path to save the scene as (legacy compatibility).',
          },
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
          guidelinesFilePath: {
            type: 'string',
            description:
              'When action=guidelines.*: optional path to AI_GUIDELINES.md (defaults to AI_GUIDELINES.md at project root if present).',
          },
          query: { type: 'string', description: 'Search query string.' },
          section: {
            type: 'string',
            description:
              'Section heading text (exact match after trimming; ex: "Physics System").',
          },
          className: {
            type: 'string',
            description: 'Godot class name (ex: Node, Node2D).',
          },
          maxMatches: {
            type: 'number',
            description: 'Max matches to return (default: 10).',
          },
          maxChars: {
            type: 'number',
            description:
              'Max characters to return for extracted docs/sections (default: 12000).',
          },
          maxResults: {
            type: 'number',
            description: 'When action=docs.search: max results (default: 10).',
          },
          options: strictObjectSchema({
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
          }),
        };

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional: [
            'mode',
            'projectPath',
            'godotPath',
            'token',
            'host',
            'port',
            'timeoutMs',
          ],
          variants: [
            { action: 'launch', required: ['projectPath'], optional: [] },
            { action: 'connect', required: ['projectPath'], optional: [] },
            { action: 'status', required: [], optional: [] },
            { action: 'run', required: [], optional: ['scene'] },
            { action: 'stop', required: [], optional: [] },
            {
              action: 'smoke_test',
              required: ['projectPath'],
              optional: ['scene', 'waitMs', 'failOnIssues'],
            },
            {
              action: 'new_scene',
              required: ['projectPath', 'scenePath'],
              optional: ['rootNodeType'],
            },
            { action: 'open_scene', required: ['scenePath'], optional: [] },
            {
              action: 'save_scene',
              required: ['projectPath', 'scenePath'],
              optional: ['newPath'],
            },
            { action: 'save_all', required: [], optional: [] },
            { action: 'restart', required: [], optional: [] },
            { action: 'get_state', required: [], optional: [] },
            {
              action: 'guidelines.search',
              required: ['projectPath', 'query'],
              optional: ['guidelinesFilePath', 'maxMatches'],
            },
            {
              action: 'guidelines.get_section',
              required: ['projectPath', 'section'],
              optional: ['guidelinesFilePath', 'maxChars'],
            },
            {
              action: 'docs.search',
              required: ['query'],
              optional: ['maxResults', 'maxChars'],
            },
            {
              action: 'docs.get_class',
              required: ['className'],
              optional: ['maxChars'],
            },
            {
              action: 'doctor_report',
              required: ['projectPath'],
              optional: ['reportRelativePath', 'options'],
            },
          ],
        });
      })(),
    },
    annotations: { destructiveHint: true, headlessHint: true },
  },
  {
    name: 'godot_log_manager',
    description:
      'Read/poll Godot editor logs for error-like lines (requires editor bridge).',
    inputSchema: {
      ...(() => {
        const props = {
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
        };

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional: ['timeoutMs'],
          variants: [
            {
              action: 'poll',
              required: [],
              optional: [
                'cursor',
                'maxBytes',
                'maxMatches',
                'onlyErrors',
                'pattern',
                'openScriptOnError',
              ],
            },
            {
              action: 'tail',
              required: [],
              optional: [
                'cursor',
                'maxBytes',
                'maxMatches',
                'onlyErrors',
                'pattern',
                'openScriptOnError',
              ],
            },
            { action: 'clear_output', required: [], optional: [] },
          ],
        });
      })(),
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'godot_editor_view_manager',
    description:
      'Unified editor UI tool (multi-action; requires editor bridge).',
    inputSchema: {
      ...(() => {
        const props = {
          timeoutMs: { type: 'number' },
          maxSize: { type: 'number' },
          savePath: {
            type: 'string',
            description: 'Optional: Local path to save the captured PNG',
          },
          screenName: { type: 'string' },
          scriptPath: { type: 'string' },
          lineNumber: { type: 'number' },
          rootPath: { type: 'string' },
          nameContains: { type: 'string' },
          className: { type: 'string' },
          textContains: { type: 'string' },
          visibleOnly: { type: 'boolean' },
          maxResults: { type: 'number' },
          maxNodes: { type: 'number' },
          includeTextPreview: { type: 'boolean' },
          panelPath: { type: 'string' },
          includePaths: { type: 'boolean' },
          includeTextEdits: { type: 'boolean' },
          includeTreeItems: { type: 'boolean' },
          includeItemLists: { type: 'boolean' },
          maxChars: { type: 'number' },
          maxItems: { type: 'number' },
          returnEntries: { type: 'boolean' },
        };

        return actionOneOfSchema({
          actionKey: 'action',
          properties: props,
          commonOptional: ['timeoutMs'],
          variants: [
            {
              action: 'capture_viewport',
              required: [],
              optional: ['maxSize', 'savePath'],
            },
            { action: 'switch_screen', required: ['screenName'], optional: [] },
            {
              action: 'edit_script',
              required: ['scriptPath'],
              optional: ['lineNumber'],
            },
            {
              action: 'add_breakpoint',
              required: ['scriptPath', 'lineNumber'],
              optional: [],
            },
            { action: 'list_open_scripts', required: [], optional: [] },
            {
              action: 'panel.find',
              required: [],
              optional: [
                'rootPath',
                'nameContains',
                'className',
                'textContains',
                'visibleOnly',
                'maxResults',
                'maxNodes',
                'includeTextPreview',
              ],
            },
            {
              action: 'panel.read',
              required: ['panelPath'],
              optional: [
                'visibleOnly',
                'includePaths',
                'includeTextEdits',
                'includeTreeItems',
                'includeItemLists',
                'maxNodes',
                'maxChars',
                'maxItems',
                'returnEntries',
              ],
            },
          ],
        });
      })(),
    },
    annotations: { destructiveHint: true },
  },
];
