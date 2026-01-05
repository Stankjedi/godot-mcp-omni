import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNumber,
  asOptionalString,
  asRecord,
} from '../validation.js';

import { assertEditorRpcAllowed } from '../security.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';

import {
  callBaseTool,
  defaultVector2,
  defaultVector3,
  extractNodePath,
  joinNodePath,
  normalizeNodePath,
  normalizeAction,
  supportedActionError,
  type BaseToolHandlers,
} from './unified/shared.js';

import { generateTerrainShader } from './builder/terrain_shaders.js';

const SUPPORTED_ACTIONS = [
  'lighting_preset',
  'create_primitive',
  'create_ui_template',
  'create_audio_player',
  'spawn_fps_controller',
  'create_health_bar_ui',
  'spawn_spinning_pickup',
  'create_particle_effect',
  'generate_terrain_mesh',
  'create_terrain_material',
  'create_trigger_area',
  'create_rigidbody',
  'set_anchor_preset',
  'set_anchor_values',
] as const;

type SupportedAction = (typeof SUPPORTED_ACTIONS)[number];

function defaultBool(
  value: unknown,
  fieldName: string,
  fallback: boolean,
): boolean {
  return asOptionalBoolean(value, fieldName) ?? fallback;
}

function parseNumberLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseColorLike(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.$type === 'Color') return obj;
    const r = parseNumberLike(obj.r);
    const g = parseNumberLike(obj.g);
    const b = parseNumberLike(obj.b);
    const a = parseNumberLike(obj.a ?? 1);
    if (r === null || g === null || b === null || a === null) return null;
    return { $type: 'Color', r, g, b, a };
  }
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  if (raw.startsWith('#') && (raw.length === 7 || raw.length === 9)) {
    const hex = raw.slice(1);
    const n = Number.parseInt(hex, 16);
    if (!Number.isFinite(n)) return null;
    const hasAlpha = hex.length === 8;
    const r = ((n >> (hasAlpha ? 24 : 16)) & 0xff) / 255;
    const g = ((n >> (hasAlpha ? 16 : 8)) & 0xff) / 255;
    const b = ((n >> (hasAlpha ? 8 : 0)) & 0xff) / 255;
    const a = hasAlpha ? (n & 0xff) / 255 : 1;
    return { $type: 'Color', r, g, b, a };
  }

  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length >= 3 && parts.slice(0, 3).every((p) => Number.isFinite(p))) {
    const [r, g, b] = parts;
    const a =
      parts.length >= 4 && Number.isFinite(parts[3] as number)
        ? (parts[3] as number)
        : 1;
    return { $type: 'Color', r, g, b, a };
  }

  return null;
}

function inferredDimension(
  action: SupportedAction,
  argsObj: Record<string, unknown>,
): '2d' | '3d' {
  const dimension =
    typeof argsObj.dimension === 'string'
      ? argsObj.dimension.trim().toLowerCase()
      : '';
  if (dimension === '2d') return '2d';
  if (dimension === '3d') return '3d';
  if (action === 'create_trigger_area') return '3d';
  return '3d';
}

export function createBuilderManagerToolHandlers(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): Record<string, ToolHandler> {
  return {
    godot_builder_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw) as SupportedAction;

      if (!SUPPORTED_ACTIONS.includes(action)) {
        return supportedActionError('godot_builder_manager', actionRaw, [
          ...SUPPORTED_ACTIONS,
        ]);
      }

      const projectPath =
        typeof argsObj.projectPath === 'string' && argsObj.projectPath.trim()
          ? argsObj.projectPath.trim()
          : null;
      if (projectPath) ctx.assertValidProject(projectPath);

      const scenePath =
        typeof argsObj.scenePath === 'string' && argsObj.scenePath.trim()
          ? argsObj.scenePath.trim()
          : null;

      const parentNodePath =
        typeof argsObj.parentNodePath === 'string' &&
        argsObj.parentNodePath.trim()
          ? argsObj.parentNodePath.trim()
          : 'root';

      const ensureUniqueName = defaultBool(
        argsObj.ensureUniqueName,
        'ensureUniqueName',
        true,
      );

      if (action === 'lighting_preset') {
        const lightingPresetRaw =
          typeof argsObj.lightingPreset === 'string' &&
          argsObj.lightingPreset.trim()
            ? argsObj.lightingPreset.trim().toLowerCase()
            : 'basic_3d';
        const lightingPreset = [
          'basic_2d',
          'basic_3d',
          'sunny',
          'overcast',
          'sunset',
          'night',
          'indoor',
        ].includes(lightingPresetRaw)
          ? lightingPresetRaw
          : 'basic_3d';

        const lightPropsByPreset: Record<string, Record<string, unknown>> = {
          sunny: {
            rotation_degrees: { $type: 'Vector3', x: -45, y: -30, z: 0 },
            light_color: { $type: 'Color', r: 1.0, g: 0.95, b: 0.85, a: 1.0 },
            light_energy: 1.2,
            shadow_enabled: true,
          },
          overcast: {
            rotation_degrees: { $type: 'Vector3', x: -60, y: -20, z: 0 },
            light_color: { $type: 'Color', r: 0.85, g: 0.85, b: 0.9, a: 1.0 },
            light_energy: 0.6,
            shadow_enabled: true,
          },
          sunset: {
            rotation_degrees: { $type: 'Vector3', x: -10, y: -60, z: 0 },
            light_color: { $type: 'Color', r: 1.0, g: 0.6, b: 0.3, a: 1.0 },
            light_energy: 1.0,
            shadow_enabled: true,
          },
          night: {
            rotation_degrees: { $type: 'Vector3', x: -30, y: 45, z: 0 },
            light_color: { $type: 'Color', r: 0.6, g: 0.7, b: 0.9, a: 1.0 },
            light_energy: 0.15,
            shadow_enabled: true,
          },
          indoor: {
            rotation_degrees: { $type: 'Vector3', x: -90, y: 0, z: 0 },
            light_color: { $type: 'Color', r: 1.0, g: 0.95, b: 0.9, a: 1.0 },
            light_energy: 0.3,
            shadow_enabled: false,
          },
        };

        const envPropsByPreset: Record<string, Record<string, unknown>> = {
          sunny: {
            background_mode: 2,
            sky: {
              $resource: 'Sky',
              props: {
                sky_material: {
                  $resource: 'ProceduralSkyMaterial',
                  props: {
                    sky_top_color: {
                      $type: 'Color',
                      r: 0.35,
                      g: 0.55,
                      b: 0.9,
                      a: 1.0,
                    },
                    sky_horizon_color: {
                      $type: 'Color',
                      r: 0.65,
                      g: 0.75,
                      b: 0.9,
                      a: 1.0,
                    },
                    ground_bottom_color: {
                      $type: 'Color',
                      r: 0.2,
                      g: 0.17,
                      b: 0.13,
                      a: 1.0,
                    },
                    ground_horizon_color: {
                      $type: 'Color',
                      r: 0.65,
                      g: 0.65,
                      b: 0.6,
                      a: 1.0,
                    },
                    sun_angle_max: 30.0,
                  },
                },
              },
            },
            ambient_light_color: {
              $type: 'Color',
              r: 1.0,
              g: 1.0,
              b: 1.0,
              a: 1.0,
            },
            ambient_light_energy: 0.5,
          },
          overcast: {
            background_mode: 2,
            sky: {
              $resource: 'Sky',
              props: {
                sky_material: {
                  $resource: 'ProceduralSkyMaterial',
                  props: {
                    sky_top_color: {
                      $type: 'Color',
                      r: 0.5,
                      g: 0.55,
                      b: 0.6,
                      a: 1.0,
                    },
                    sky_horizon_color: {
                      $type: 'Color',
                      r: 0.7,
                      g: 0.72,
                      b: 0.75,
                      a: 1.0,
                    },
                    ground_bottom_color: {
                      $type: 'Color',
                      r: 0.3,
                      g: 0.3,
                      b: 0.3,
                      a: 1.0,
                    },
                    ground_horizon_color: {
                      $type: 'Color',
                      r: 0.6,
                      g: 0.6,
                      b: 0.6,
                      a: 1.0,
                    },
                  },
                },
              },
            },
            ambient_light_color: {
              $type: 'Color',
              r: 0.8,
              g: 0.8,
              b: 0.85,
              a: 1.0,
            },
            ambient_light_energy: 0.7,
            fog_enabled: true,
            fog_density: 0.01,
            fog_light_color: {
              $type: 'Color',
              r: 0.7,
              g: 0.7,
              b: 0.75,
              a: 1.0,
            },
          },
          sunset: {
            background_mode: 2,
            sky: {
              $resource: 'Sky',
              props: {
                sky_material: {
                  $resource: 'ProceduralSkyMaterial',
                  props: {
                    sky_top_color: {
                      $type: 'Color',
                      r: 0.2,
                      g: 0.15,
                      b: 0.35,
                      a: 1.0,
                    },
                    sky_horizon_color: {
                      $type: 'Color',
                      r: 1.0,
                      g: 0.5,
                      b: 0.2,
                      a: 1.0,
                    },
                    ground_bottom_color: {
                      $type: 'Color',
                      r: 0.1,
                      g: 0.08,
                      b: 0.06,
                      a: 1.0,
                    },
                    ground_horizon_color: {
                      $type: 'Color',
                      r: 0.8,
                      g: 0.4,
                      b: 0.2,
                      a: 1.0,
                    },
                    sun_angle_max: 5.0,
                  },
                },
              },
            },
            ambient_light_color: {
              $type: 'Color',
              r: 1.0,
              g: 0.7,
              b: 0.5,
              a: 1.0,
            },
            ambient_light_energy: 0.3,
          },
          night: {
            background_mode: 2,
            sky: {
              $resource: 'Sky',
              props: {
                sky_material: {
                  $resource: 'ProceduralSkyMaterial',
                  props: {
                    sky_top_color: {
                      $type: 'Color',
                      r: 0.02,
                      g: 0.02,
                      b: 0.08,
                      a: 1.0,
                    },
                    sky_horizon_color: {
                      $type: 'Color',
                      r: 0.05,
                      g: 0.05,
                      b: 0.12,
                      a: 1.0,
                    },
                    ground_bottom_color: {
                      $type: 'Color',
                      r: 0.01,
                      g: 0.01,
                      b: 0.02,
                      a: 1.0,
                    },
                    ground_horizon_color: {
                      $type: 'Color',
                      r: 0.03,
                      g: 0.03,
                      b: 0.06,
                      a: 1.0,
                    },
                  },
                },
              },
            },
            ambient_light_color: {
              $type: 'Color',
              r: 0.1,
              g: 0.12,
              b: 0.2,
              a: 1.0,
            },
            ambient_light_energy: 0.3,
            glow_enabled: true,
            glow_intensity: 0.5,
          },
          indoor: {
            background_mode: 1,
            background_color: {
              $type: 'Color',
              r: 0.15,
              g: 0.15,
              b: 0.15,
              a: 1.0,
            },
            ambient_light_color: {
              $type: 'Color',
              r: 1.0,
              g: 0.95,
              b: 0.9,
              a: 1.0,
            },
            ambient_light_energy: 0.6,
            ssao_enabled: true,
          },
        };

        const includeWorldEnvironment = defaultBool(
          argsObj.includeWorldEnvironment,
          'includeWorldEnvironment',
          true,
        );
        const includeDirectionalLight = defaultBool(
          argsObj.includeDirectionalLight,
          'includeDirectionalLight',
          true,
        );

        const createdNodes: Array<Record<string, unknown>> = [];
        const steps: ToolResponse[] = [];

        const run = async (
          tool: string,
          forwardedArgs: Record<string, unknown>,
        ) => {
          const resp = await callBaseTool(baseHandlers, tool, forwardedArgs);
          steps.push(resp);
          if (!resp.ok) return resp;
          const nodePath = extractNodePath(resp);
          if (nodePath) createdNodes.push({ tool, nodePath });
          return resp;
        };

        if (includeDirectionalLight) {
          if (lightingPreset === 'basic_2d') {
            const resp = await run('godot_scene_manager', {
              action: 'create',
              nodeType: 'PointLight2D',
              nodeName: 'PointLight2D',
              parentNodePath,
              ensureUniqueName,
              dimension: '2d',
              ...(projectPath ? { projectPath } : {}),
              ...(scenePath ? { scenePath } : {}),
            });
            if (!resp.ok)
              return {
                ok: false,
                summary: 'lighting_preset failed',
                details: { steps },
              };
          } else {
            const lightProps = lightPropsByPreset[lightingPreset] ?? {};
            const resp = await run('godot_scene_manager', {
              action: 'create',
              nodeType: 'DirectionalLight3D',
              nodeName:
                lightingPreset === 'basic_3d' ? 'DirectionalLight3D' : 'Sun',
              parentNodePath,
              ensureUniqueName,
              dimension: '3d',
              ...(Object.keys(lightProps).length > 0
                ? { props: lightProps }
                : {}),
              ...(projectPath ? { projectPath } : {}),
              ...(scenePath ? { scenePath } : {}),
            });
            if (!resp.ok)
              return {
                ok: false,
                summary: 'lighting_preset failed',
                details: { steps },
              };
          }
        }

        if (includeWorldEnvironment && lightingPreset !== 'basic_2d') {
          const envProps = envPropsByPreset[lightingPreset] ?? {};
          const envResource: Record<string, unknown> = {
            $resource: 'Environment',
            ...(Object.keys(envProps).length > 0 ? { props: envProps } : {}),
          };
          const resp = await run('godot_scene_manager', {
            action: 'create',
            nodeType: 'WorldEnvironment',
            nodeName: 'WorldEnvironment',
            parentNodePath,
            ensureUniqueName,
            dimension: '3d',
            props: { environment: envResource },
            ...(projectPath ? { projectPath } : {}),
            ...(scenePath ? { scenePath } : {}),
          });
          if (!resp.ok)
            return {
              ok: false,
              summary: 'lighting_preset failed',
              details: { steps },
            };
        }

        return {
          ok: true,
          summary: 'lighting_preset completed',
          details: {
            preset: lightingPreset,
            createdNodes,
            steps,
            suggestions:
              lightingPreset === 'basic_2d'
                ? [
                    'PointLight2D requires a texture for visible falloff in many setups.',
                    'Consider adding CanvasModulate or lights/occluders depending on your 2D pipeline.',
                  ]
                : [
                    'WorldEnvironment.environment is created for 3D presets (tune ambient/fog/glow as needed).',
                    'Consider enabling shadows and adjusting directional light rotation for your level scale.',
                  ],
          },
        };
      }

      if (action === 'create_ui_template') {
        const templateRaw =
          typeof argsObj.uiTemplate === 'string' && argsObj.uiTemplate.trim()
            ? argsObj.uiTemplate.trim().toLowerCase()
            : 'basic';
        const uiTemplate = [
          'basic',
          'hud',
          'menu',
          'main_menu',
          'pause_menu',
          'dialogue_box',
          'inventory_grid',
        ].includes(templateRaw)
          ? templateRaw
          : 'basic';

        const normalizedParent = normalizeNodePath(parentNodePath);
        const uiRootName =
          typeof argsObj.uiRootName === 'string' && argsObj.uiRootName.trim()
            ? argsObj.uiRootName.trim()
            : 'UI';
        const uiControlName =
          typeof argsObj.uiControlName === 'string' &&
          argsObj.uiControlName.trim()
            ? argsObj.uiControlName.trim()
            : 'UIRoot';
        const uiRootPath = joinNodePath(normalizedParent, uiRootName);
        const uiControlPath = joinNodePath(uiRootPath, uiControlName);

        let elements =
          Array.isArray(argsObj.elements) && argsObj.elements.length > 0
            ? argsObj.elements
            : [];
        if (elements.length === 0) {
          if (uiTemplate === 'hud') {
            elements = [
              {
                nodeType: 'Label',
                nodeName: 'HUDLabel',
                parentNodePath: uiControlPath,
                props: { text: 'HUD', offset_left: 16, offset_top: 16 },
                layout: 'top_left',
              },
            ];
          } else if (uiTemplate === 'menu' || uiTemplate === 'main_menu') {
            const panelName = 'MenuPanel';
            const panelPath = joinNodePath(uiControlPath, panelName);
            const vboxName = 'MenuVBox';
            const vboxPath = joinNodePath(panelPath, vboxName);
            elements = [
              {
                nodeType: 'PanelContainer',
                nodeName: panelName,
                parentNodePath: uiControlPath,
                layout: 'center',
                props: {
                  offset_left: -220,
                  offset_top: -180,
                  offset_right: 220,
                  offset_bottom: 180,
                },
              },
              {
                nodeType: 'VBoxContainer',
                nodeName: vboxName,
                parentNodePath: panelPath,
                layout: 'full',
                props: { separation: 12 },
              },
              {
                nodeType: 'Label',
                nodeName: 'TitleLabel',
                parentNodePath: vboxPath,
                props: {
                  text: uiTemplate === 'main_menu' ? 'Main Menu' : 'Menu',
                },
              },
              {
                nodeType: 'Button',
                nodeName: 'StartButton',
                parentNodePath: vboxPath,
                props: { text: 'Start' },
              },
              ...(uiTemplate === 'main_menu'
                ? [
                    {
                      nodeType: 'Button',
                      nodeName: 'OptionsButton',
                      parentNodePath: vboxPath,
                      props: { text: 'Options' },
                    },
                  ]
                : []),
              {
                nodeType: 'Button',
                nodeName: 'QuitButton',
                parentNodePath: vboxPath,
                props: { text: 'Quit' },
              },
            ];
          } else if (uiTemplate === 'pause_menu') {
            const panelName = 'PausePanel';
            const panelPath = joinNodePath(uiControlPath, panelName);
            const vboxName = 'PauseVBox';
            const vboxPath = joinNodePath(panelPath, vboxName);
            elements = [
              {
                nodeType: 'PanelContainer',
                nodeName: panelName,
                parentNodePath: uiControlPath,
                layout: 'center',
                props: {
                  offset_left: -200,
                  offset_top: -160,
                  offset_right: 200,
                  offset_bottom: 160,
                },
              },
              {
                nodeType: 'VBoxContainer',
                nodeName: vboxName,
                parentNodePath: panelPath,
                layout: 'full',
                props: { separation: 12 },
              },
              {
                nodeType: 'Label',
                nodeName: 'PausedLabel',
                parentNodePath: vboxPath,
                props: { text: 'Paused' },
              },
              {
                nodeType: 'Button',
                nodeName: 'ResumeButton',
                parentNodePath: vboxPath,
                props: { text: 'Resume' },
              },
              {
                nodeType: 'Button',
                nodeName: 'QuitButton',
                parentNodePath: vboxPath,
                props: { text: 'Quit' },
              },
            ];
          } else if (uiTemplate === 'dialogue_box') {
            const panelName = 'DialoguePanel';
            const panelPath = joinNodePath(uiControlPath, panelName);
            const vboxName = 'DialogueVBox';
            const vboxPath = joinNodePath(panelPath, vboxName);
            elements = [
              {
                nodeType: 'PanelContainer',
                nodeName: panelName,
                parentNodePath: uiControlPath,
                layout: 'bottom',
                props: {
                  offset_left: 16,
                  offset_right: -16,
                  offset_top: -180,
                  offset_bottom: -16,
                },
              },
              {
                nodeType: 'VBoxContainer',
                nodeName: vboxName,
                parentNodePath: panelPath,
                layout: 'full',
                props: { separation: 8 },
              },
              {
                nodeType: 'Label',
                nodeName: 'SpeakerLabel',
                parentNodePath: vboxPath,
                props: { text: 'Speaker' },
              },
              {
                nodeType: 'RichTextLabel',
                nodeName: 'DialogueText',
                parentNodePath: vboxPath,
                props: { text: 'Hello, world!', fit_content: true },
              },
            ];
          } else if (uiTemplate === 'inventory_grid') {
            const panelName = 'InventoryPanel';
            const panelPath = joinNodePath(uiControlPath, panelName);
            const gridName = 'InventoryGrid';
            const gridPath = joinNodePath(panelPath, gridName);
            elements = [
              {
                nodeType: 'PanelContainer',
                nodeName: panelName,
                parentNodePath: uiControlPath,
                layout: 'center',
                props: {
                  offset_left: -240,
                  offset_top: -200,
                  offset_right: 240,
                  offset_bottom: 200,
                },
              },
              {
                nodeType: 'GridContainer',
                nodeName: gridName,
                parentNodePath: panelPath,
                layout: 'full',
                props: { columns: 4, h_separation: 8, v_separation: 8 },
              },
              {
                nodeType: 'Label',
                nodeName: 'InventoryHint',
                parentNodePath: gridPath,
                props: { text: 'Inventory' },
              },
            ];
          }
        }

        const resp = await callBaseTool(baseHandlers, 'godot_scene_manager', {
          action: 'create_ui',
          parentNodePath,
          ensureUniqueName,
          ...(typeof argsObj.uiRootType === 'string'
            ? { uiRootType: argsObj.uiRootType }
            : {}),
          ...(typeof argsObj.uiRootName === 'string'
            ? { uiRootName: argsObj.uiRootName }
            : {}),
          ...(typeof argsObj.uiControlType === 'string'
            ? { uiControlType: argsObj.uiControlType }
            : {}),
          ...(typeof argsObj.uiControlName === 'string'
            ? { uiControlName: argsObj.uiControlName }
            : {}),
          ...(Array.isArray(elements) ? { elements } : {}),
          ...(projectPath ? { projectPath } : {}),
          ...(scenePath ? { scenePath } : {}),
        });

        return {
          ok: resp.ok,
          summary: resp.ok
            ? 'create_ui_template completed'
            : 'create_ui_template failed',
          details: { uiTemplate, response: resp },
          logs: resp.logs,
        };
      }

      if (action === 'set_anchor_preset') {
        const nodePath =
          typeof argsObj.nodePath === 'string' && argsObj.nodePath.trim()
            ? argsObj.nodePath.trim()
            : null;
        const presetRaw =
          typeof argsObj.anchorPreset === 'string' &&
          argsObj.anchorPreset.trim()
            ? argsObj.anchorPreset.trim().toLowerCase()
            : null;

        if (!nodePath || !presetRaw) {
          return {
            ok: false,
            summary: 'set_anchor_preset requires nodePath and anchorPreset',
            details: { required: ['nodePath', 'anchorPreset'] },
          };
        }

        const keepOffsets = defaultBool(
          argsObj.keepOffsets,
          'keepOffsets',
          false,
        );

        const presets: Record<
          string,
          {
            anchors: [number, number, number, number];
            offsets?: [number, number, number, number];
          }
        > = {
          top_left: { anchors: [0, 0, 0, 0], offsets: [0, 0, 0, 0] },
          top_right: { anchors: [1, 0, 1, 0], offsets: [0, 0, 0, 0] },
          bottom_left: { anchors: [0, 1, 0, 1], offsets: [0, 0, 0, 0] },
          bottom_right: { anchors: [1, 1, 1, 1], offsets: [0, 0, 0, 0] },
          center_left: { anchors: [0, 0.5, 0, 0.5], offsets: [0, 0, 0, 0] },
          center_right: { anchors: [1, 0.5, 1, 0.5], offsets: [0, 0, 0, 0] },
          center_top: { anchors: [0.5, 0, 0.5, 0], offsets: [0, 0, 0, 0] },
          center_bottom: { anchors: [0.5, 1, 0.5, 1], offsets: [0, 0, 0, 0] },
          center: { anchors: [0.5, 0.5, 0.5, 0.5], offsets: [0, 0, 0, 0] },
          left_wide: { anchors: [0, 0, 0, 1], offsets: [0, 0, 0, 0] },
          right_wide: { anchors: [1, 0, 1, 1], offsets: [0, 0, 0, 0] },
          top_wide: { anchors: [0, 0, 1, 0], offsets: [0, 0, 0, 0] },
          bottom_wide: { anchors: [0, 1, 1, 1], offsets: [0, 0, 0, 0] },
          vcenter_wide: { anchors: [0, 0.5, 1, 0.5], offsets: [0, 0, 0, 0] },
          hcenter_wide: { anchors: [0.5, 0, 0.5, 1], offsets: [0, 0, 0, 0] },
          full_rect: { anchors: [0, 0, 1, 1], offsets: [0, 0, 0, 0] },
        };

        const preset = presets[presetRaw];
        if (!preset) {
          return {
            ok: false,
            summary: `Unknown anchorPreset: ${presetRaw}`,
            details: { supported: Object.keys(presets) },
          };
        }

        const [al, at, ar, ab] = preset.anchors;
        const anchorProps: Record<string, unknown> = {
          anchor_left: al,
          anchor_top: at,
          anchor_right: ar,
          anchor_bottom: ab,
        };
        if (!keepOffsets && preset.offsets) {
          const [ol, ot, or, ob] = preset.offsets;
          anchorProps.offset_left = ol;
          anchorProps.offset_top = ot;
          anchorProps.offset_right = or;
          anchorProps.offset_bottom = ob;
        }

        const editorConnected = ctx.getEditorClient()?.isConnected ?? false;
        const resp = editorConnected
          ? await callBaseTool(baseHandlers, 'godot_editor_batch', {
              actionName: 'godot_builder_manager:set_anchor_preset',
              steps: Object.entries(anchorProps).map(([property, value]) => ({
                method: 'set_property',
                params: { node_path: nodePath, property, value },
              })),
            })
          : projectPath && scenePath
            ? await callBaseTool(baseHandlers, 'godot_scene_manager', {
                action: 'update',
                nodePath,
                props: anchorProps,
                projectPath,
                scenePath,
              })
            : null;

        if (!resp) {
          return {
            ok: false,
            summary:
              'set_anchor_preset requires an editor bridge connection or (projectPath + scenePath) for headless mode',
            details: {
              required: [
                'nodePath',
                'anchorPreset',
                'projectPath + scenePath (headless)',
              ],
              suggestions: [
                'Call godot_workspace_manager(action="connect")',
                'Or pass projectPath + scenePath to edit the scene file headlessly.',
              ],
            },
          };
        }

        return {
          ok: resp.ok,
          summary: resp.ok
            ? 'set_anchor_preset completed'
            : 'set_anchor_preset failed',
          details: {
            nodePath,
            anchorPreset: presetRaw,
            keepOffsets,
            applied: anchorProps,
            response: resp,
          },
          logs: resp.logs,
        };
      }

      if (action === 'set_anchor_values') {
        const nodePath =
          typeof argsObj.nodePath === 'string' && argsObj.nodePath.trim()
            ? argsObj.nodePath.trim()
            : null;
        if (!nodePath) {
          return {
            ok: false,
            summary: 'set_anchor_values requires nodePath',
            details: { required: ['nodePath'] },
          };
        }

        const left =
          asOptionalNumber((argsObj as Record<string, unknown>).left, 'left') ??
          asOptionalNumber(
            (argsObj as Record<string, unknown>).anchorLeft,
            'anchorLeft',
          ) ??
          0;
        const top =
          asOptionalNumber((argsObj as Record<string, unknown>).top, 'top') ??
          asOptionalNumber(
            (argsObj as Record<string, unknown>).anchorTop,
            'anchorTop',
          ) ??
          0;
        const right =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).right,
            'right',
          ) ??
          asOptionalNumber(
            (argsObj as Record<string, unknown>).anchorRight,
            'anchorRight',
          ) ??
          1;
        const bottom =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).bottom,
            'bottom',
          ) ??
          asOptionalNumber(
            (argsObj as Record<string, unknown>).anchorBottom,
            'anchorBottom',
          ) ??
          1;

        const resp = await callBaseTool(baseHandlers, 'godot_scene_manager', {
          action: 'update',
          nodePath,
          props: {
            anchor_left: left,
            anchor_top: top,
            anchor_right: right,
            anchor_bottom: bottom,
          },
          ...(projectPath ? { projectPath } : {}),
          ...(scenePath ? { scenePath } : {}),
        });

        return {
          ok: resp.ok,
          summary: resp.ok
            ? 'set_anchor_values completed'
            : 'set_anchor_values failed',
          details: { nodePath, left, top, right, bottom, response: resp },
          logs: resp.logs,
        };
      }

      if (action === 'create_audio_player') {
        const nodeName =
          typeof argsObj.nodeName === 'string' && argsObj.nodeName.trim()
            ? argsObj.nodeName.trim()
            : typeof (argsObj as Record<string, unknown>).name === 'string' &&
                String((argsObj as Record<string, unknown>).name).trim()
              ? String((argsObj as Record<string, unknown>).name).trim()
              : null;
        if (!nodeName) {
          return {
            ok: false,
            summary: 'create_audio_player requires nodeName',
            details: { required: ['nodeName'] },
          };
        }

        const dimension = inferredDimension(action, argsObj);
        const nodeType =
          dimension === '2d'
            ? 'AudioStreamPlayer2D'
            : dimension === '3d'
              ? 'AudioStreamPlayer3D'
              : 'AudioStreamPlayer';

        const bus = asOptionalString(
          (argsObj as Record<string, unknown>).bus,
          'bus',
        )?.trim();
        const autoplay =
          asOptionalBoolean(
            (argsObj as Record<string, unknown>).autoplay,
            'autoplay',
          ) ?? false;
        const props: Record<string, unknown> = { autoplay };
        if (bus) props.bus = bus;

        const resp = await callBaseTool(baseHandlers, 'godot_scene_manager', {
          action: 'create',
          nodeType,
          nodeName,
          parentNodePath,
          ensureUniqueName,
          dimension,
          props,
          ...(projectPath ? { projectPath } : {}),
          ...(scenePath ? { scenePath } : {}),
        });

        return {
          ok: resp.ok,
          summary: resp.ok
            ? 'create_audio_player completed'
            : 'create_audio_player failed',
          details: {
            nodeType,
            nodeName,
            parentNodePath,
            bus: bus ?? null,
            autoplay,
            response: resp,
          },
          logs: resp.logs,
        };
      }

      if (action === 'spawn_fps_controller') {
        const playerName =
          typeof argsObj.nodeName === 'string' && argsObj.nodeName.trim()
            ? argsObj.nodeName.trim()
            : typeof (argsObj as Record<string, unknown>).name === 'string' &&
                String((argsObj as Record<string, unknown>).name).trim()
              ? String((argsObj as Record<string, unknown>).name).trim()
              : 'Player';

        const cameraHeight =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).cameraHeight,
            'cameraHeight',
          ) ?? 1.6;
        const capsuleRadius =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).capsuleRadius,
            'capsuleRadius',
          ) ?? 0.4;
        const capsuleHeight =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).capsuleHeight,
            'capsuleHeight',
          ) ?? 1.2;

        const steps: ToolResponse[] = [];
        const createdNodes: Array<Record<string, unknown>> = [];

        const run = async (
          tool: string,
          forwardedArgs: Record<string, unknown>,
        ) => {
          const resp = await callBaseTool(baseHandlers, tool, forwardedArgs);
          steps.push(resp);
          if (!resp.ok) return resp;
          const nodePath = extractNodePath(resp);
          if (nodePath) createdNodes.push({ tool, nodePath });
          return resp;
        };

        const rootResp = await run('godot_scene_manager', {
          action: 'create',
          nodeType: 'CharacterBody3D',
          nodeName: playerName,
          parentNodePath,
          ensureUniqueName,
          dimension: '3d',
          ...(projectPath ? { projectPath } : {}),
          ...(scenePath ? { scenePath } : {}),
        });
        if (!rootResp.ok)
          return {
            ok: false,
            summary: 'spawn_fps_controller failed',
            details: { steps },
          };

        const playerNodePath = extractNodePath(rootResp) ?? playerName;

        const colliderResp = await run('godot_scene_manager', {
          action: 'create',
          nodeType: 'CollisionShape3D',
          nodeName: 'CollisionShape3D',
          parentNodePath: playerNodePath,
          ensureUniqueName: true,
          dimension: '3d',
          props: {
            shape: {
              $resource: 'CapsuleShape3D',
              props: { radius: capsuleRadius, height: capsuleHeight },
            },
          },
          ...(projectPath ? { projectPath } : {}),
          ...(scenePath ? { scenePath } : {}),
        });
        if (!colliderResp.ok)
          return {
            ok: false,
            summary: 'spawn_fps_controller failed',
            details: { steps },
          };

        const cameraResp = await run('godot_scene_manager', {
          action: 'create',
          nodeType: 'Camera3D',
          nodeName: 'Camera3D',
          parentNodePath: playerNodePath,
          ensureUniqueName: true,
          dimension: '3d',
          props: {
            position: { $type: 'Vector3', x: 0, y: cameraHeight, z: 0 },
            current: true,
          },
          ...(projectPath ? { projectPath } : {}),
          ...(scenePath ? { scenePath } : {}),
        });
        if (!cameraResp.ok)
          return {
            ok: false,
            summary: 'spawn_fps_controller failed',
            details: { steps },
          };

        return {
          ok: true,
          summary: 'spawn_fps_controller completed',
          details: {
            playerNodePath,
            cameraHeight,
            capsuleRadius,
            capsuleHeight,
            createdNodes,
            steps,
            suggestions: [
              'Add an input_map action set via godot_project_config_manager(action="input_map.setup") for movement.',
              'Attach a movement script to the CharacterBody3D to enable WASD + mouse look.',
            ],
          },
        };
      }

      if (action === 'create_health_bar_ui') {
        const rootName =
          typeof argsObj.nodeName === 'string' && argsObj.nodeName.trim()
            ? argsObj.nodeName.trim()
            : 'HealthBar';

        const width =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).width,
            'width',
          ) ?? 240;
        const height =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).height,
            'height',
          ) ?? 24;

        const steps: ToolResponse[] = [];
        const createdNodes: Array<Record<string, unknown>> = [];

        const run = async (
          tool: string,
          forwardedArgs: Record<string, unknown>,
        ) => {
          const resp = await callBaseTool(baseHandlers, tool, forwardedArgs);
          steps.push(resp);
          if (!resp.ok) return resp;
          const nodePath = extractNodePath(resp);
          if (nodePath) createdNodes.push({ tool, nodePath });
          return resp;
        };

        const canvasResp = await run('godot_scene_manager', {
          action: 'create',
          nodeType: 'CanvasLayer',
          nodeName: rootName,
          parentNodePath,
          ensureUniqueName,
          dimension: '2d',
          props: { layer: 10 },
          ...(projectPath ? { projectPath } : {}),
          ...(scenePath ? { scenePath } : {}),
        });
        if (!canvasResp.ok)
          return {
            ok: false,
            summary: 'create_health_bar_ui failed',
            details: { steps },
          };

        const canvasPath = extractNodePath(canvasResp) ?? rootName;

        const barResp = await run('godot_scene_manager', {
          action: 'create',
          nodeType: 'ProgressBar',
          nodeName: 'Bar',
          parentNodePath: canvasPath,
          ensureUniqueName: true,
          dimension: '2d',
          props: {
            position: { $type: 'Vector2', x: 20, y: 20 },
            custom_minimum_size: { $type: 'Vector2', x: width, y: height },
            size: { $type: 'Vector2', x: width, y: height },
            min_value: 0,
            max_value: 100,
            value: 100,
          },
          ...(projectPath ? { projectPath } : {}),
          ...(scenePath ? { scenePath } : {}),
        });
        if (!barResp.ok)
          return {
            ok: false,
            summary: 'create_health_bar_ui failed',
            details: { steps },
          };

        return {
          ok: true,
          summary: 'create_health_bar_ui completed',
          details: {
            rootName,
            width,
            height,
            createdNodes,
            steps,
            notes: [
              'This creates a minimal CanvasLayer + ProgressBar. Customize theme/style/textures as needed.',
            ],
          },
        };
      }

      if (action === 'spawn_spinning_pickup') {
        const pickupName =
          typeof argsObj.nodeName === 'string' && argsObj.nodeName.trim()
            ? argsObj.nodeName.trim()
            : 'Pickup';
        const pickupScenePath =
          asOptionalString(
            (argsObj as Record<string, unknown>).pickupScenePath ??
              (argsObj as Record<string, unknown>).pickup_scene_path ??
              (argsObj as Record<string, unknown>).instanceScenePath ??
              (argsObj as Record<string, unknown>).instance_scene_path,
            'pickupScenePath',
          )?.trim() ?? 'res://coin.tscn';

        const steps: ToolResponse[] = [];
        const createdNodes: Array<Record<string, unknown>> = [];

        const run = async (
          tool: string,
          forwardedArgs: Record<string, unknown>,
        ) => {
          const resp = await callBaseTool(baseHandlers, tool, forwardedArgs);
          steps.push(resp);
          if (!resp.ok) return resp;
          const nodePath = extractNodePath(resp);
          if (nodePath) createdNodes.push({ tool, nodePath });
          return resp;
        };

        // 1) Try instancing a pickup scene first (best effort).
        const canEditorInstance = Boolean(ctx.getEditorClient()?.isConnected);
        const canHeadlessInstance = Boolean(projectPath && scenePath);

        const instanceResp = canEditorInstance
          ? await run('godot_scene_manager', {
              action: 'instance',
              scenePath: pickupScenePath,
              parentNodePath,
              name: pickupName,
              ensureUniqueName,
              ...(projectPath ? { projectPath } : {}),
            })
          : canHeadlessInstance
            ? await run('godot_scene_manager', {
                action: 'instance',
                projectPath,
                scenePath,
                instanceScenePath: pickupScenePath,
                parentNodePath,
                name: pickupName,
                ensureUniqueName,
              })
            : null;

        let pickupNodePath =
          instanceResp && instanceResp.ok
            ? extractNodePath(instanceResp)
            : null;

        // 2) Fallback: create a simple pickup from scratch.
        if (!pickupNodePath) {
          const areaResp = await run('godot_scene_manager', {
            action: 'create',
            nodeType: 'Area3D',
            nodeName: pickupName,
            parentNodePath,
            ensureUniqueName,
            dimension: '3d',
            ...(projectPath ? { projectPath } : {}),
            ...(scenePath ? { scenePath } : {}),
          });
          if (!areaResp.ok)
            return {
              ok: false,
              summary: 'spawn_spinning_pickup failed',
              details: { steps },
            };
          pickupNodePath = extractNodePath(areaResp) ?? pickupName;

          await run('godot_scene_manager', {
            action: 'create',
            nodeType: 'CollisionShape3D',
            nodeName: 'CollisionShape3D',
            parentNodePath: pickupNodePath,
            ensureUniqueName: true,
            dimension: '3d',
            props: {
              shape: { $resource: 'SphereShape3D', props: { radius: 0.5 } },
            },
            ...(projectPath ? { projectPath } : {}),
            ...(scenePath ? { scenePath } : {}),
          });

          await run('godot_scene_manager', {
            action: 'create',
            nodeType: 'MeshInstance3D',
            nodeName: 'Mesh',
            parentNodePath: pickupNodePath,
            ensureUniqueName: true,
            dimension: '3d',
            props: {
              mesh: {
                $resource: 'CylinderMesh',
                props: { top_radius: 0.3, bottom_radius: 0.3, height: 0.1 },
              },
              rotation_degrees: { $type: 'Vector3', x: 90, y: 0, z: 0 },
              material_override: {
                $resource: 'StandardMaterial3D',
                props: {
                  albedo_color: { $type: 'Color', r: 1, g: 0.84, b: 0, a: 1 },
                  metallic: 0.8,
                  roughness: 0.3,
                },
              },
            },
            ...(projectPath ? { projectPath } : {}),
            ...(scenePath ? { scenePath } : {}),
          });
        }

        // 3) Optional: attach a simple spinning script (requires projectPath).
        if (projectPath && pickupNodePath) {
          const scriptPath = 'res://.godot_mcp/scripts/spinning_pickup.gd';
          const scriptCreate = await run('godot_code_manager', {
            action: 'script.create',
            projectPath,
            scriptPath,
            content: [
              'extends Node3D',
              '',
              'var speed: float = 2.0',
              '',
              'func _process(delta: float) -> void:',
              '\trotate_y(delta * speed)',
              '',
            ].join('\n'),
          });
          if (scriptCreate.ok) {
            await run('godot_scene_manager', {
              action: 'attach_script',
              nodePath: pickupNodePath,
              scriptPath,
              ...(projectPath ? { projectPath } : {}),
              ...(scenePath ? { scenePath } : {}),
            });
          }
        }

        return {
          ok: true,
          summary: 'spawn_spinning_pickup completed',
          details: {
            pickupNodePath,
            pickupScenePath,
            createdNodes,
            steps,
            notes: instanceResp?.ok
              ? ['Pickup instanced from scene.']
              : [
                  'Pickup created from scratch (scene instance failed or missing).',
                ],
          },
        };
      }

      if (action === 'create_particle_effect') {
        const preset =
          asOptionalString(
            (argsObj as Record<string, unknown>).preset,
            'preset',
          )?.trim() ?? 'fire';
        const is3d =
          asOptionalBoolean(
            (argsObj as Record<string, unknown>).is3d,
            'is3d',
          ) ??
          asOptionalBoolean(
            (argsObj as Record<string, unknown>).is_3d,
            'is_3d',
          ) ??
          true;
        const oneShot =
          asOptionalBoolean(
            (argsObj as Record<string, unknown>).oneShot,
            'oneShot',
          ) ??
          asOptionalBoolean(
            (argsObj as Record<string, unknown>).one_shot,
            'one_shot',
          ) ??
          false;
        const emitting =
          asOptionalBoolean(
            (argsObj as Record<string, unknown>).emitting,
            'emitting',
          ) ?? true;
        const nodeName =
          typeof argsObj.nodeName === 'string' && argsObj.nodeName.trim()
            ? argsObj.nodeName.trim()
            : 'Particles';

        const nodeType = is3d ? 'GPUParticles3D' : 'GPUParticles2D';

        const baseMatProps: Record<string, unknown> = {};
        const baseNodeProps: Record<string, unknown> = {
          one_shot: oneShot,
          emitting,
          amount: 64,
          lifetime: 1.5,
        };

        // Best-effort preset tuning (subset of matrix presets).
        const presetKey = preset.trim().toLowerCase();
        if (presetKey === 'smoke') {
          baseNodeProps.amount = 80;
          baseNodeProps.lifetime = 3.0;
          baseMatProps.direction = { $type: 'Vector3', x: 0, y: 1, z: 0 };
          baseMatProps.spread = 30.0;
          baseMatProps.initial_velocity_min = is3d ? 0.5 : 20.0;
          baseMatProps.initial_velocity_max = is3d ? 1.5 : 40.0;
          baseMatProps.gravity = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? 0.5 : -20,
            z: 0,
          };
          baseMatProps.scale_min = 1.0;
          baseMatProps.scale_max = 3.0;
          baseMatProps.color = {
            $type: 'Color',
            r: 0.3,
            g: 0.3,
            b: 0.3,
            a: 0.5,
          };
        } else if (presetKey === 'sparks') {
          baseNodeProps.amount = 120;
          baseNodeProps.lifetime = 0.8;
          baseMatProps.direction = { $type: 'Vector3', x: 0, y: 1, z: 0 };
          baseMatProps.spread = 60.0;
          baseMatProps.initial_velocity_min = is3d ? 3.0 : 100.0;
          baseMatProps.initial_velocity_max = is3d ? 8.0 : 200.0;
          baseMatProps.gravity = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? -9.8 : 400,
            z: 0,
          };
          baseMatProps.scale_min = 0.1;
          baseMatProps.scale_max = 0.3;
          baseMatProps.color = {
            $type: 'Color',
            r: 1.0,
            g: 0.8,
            b: 0.3,
            a: 1.0,
          };
        } else if (presetKey === 'explosion') {
          baseNodeProps.amount = 180;
          baseNodeProps.lifetime = 1.0;
          baseNodeProps.one_shot = true;
          baseMatProps.spread = 180.0;
          baseMatProps.initial_velocity_min = is3d ? 5.0 : 150.0;
          baseMatProps.initial_velocity_max = is3d ? 15.0 : 400.0;
          baseMatProps.gravity = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? -5 : 300,
            z: 0,
          };
          baseMatProps.scale_min = 0.5;
          baseMatProps.scale_max = 2.0;
        } else if (presetKey === 'snow') {
          baseNodeProps.amount = 300;
          baseNodeProps.lifetime = 4.0;
          baseMatProps.direction = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? -1 : 1,
            z: 0,
          };
          baseMatProps.spread = 12.0;
          baseMatProps.initial_velocity_min = is3d ? 0.2 : 20.0;
          baseMatProps.initial_velocity_max = is3d ? 0.8 : 60.0;
          baseMatProps.gravity = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? -1.5 : 120,
            z: 0,
          };
          baseMatProps.scale_min = 0.2;
          baseMatProps.scale_max = 0.6;
          baseMatProps.color = {
            $type: 'Color',
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 0.9,
          };
        } else if (presetKey === 'rain') {
          baseNodeProps.amount = 500;
          baseNodeProps.lifetime = 1.5;
          baseMatProps.direction = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? -1 : 1,
            z: 0,
          };
          baseMatProps.spread = 6.0;
          baseMatProps.initial_velocity_min = is3d ? 10.0 : 600.0;
          baseMatProps.initial_velocity_max = is3d ? 20.0 : 900.0;
          baseMatProps.gravity = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? -20 : 1200,
            z: 0,
          };
          baseMatProps.scale_min = 0.05;
          baseMatProps.scale_max = 0.15;
          baseMatProps.color = {
            $type: 'Color',
            r: 0.6,
            g: 0.7,
            b: 1.0,
            a: 0.8,
          };
        } else if (presetKey === 'magic') {
          baseNodeProps.amount = 140;
          baseNodeProps.lifetime = 2.0;
          baseMatProps.direction = { $type: 'Vector3', x: 0, y: 1, z: 0 };
          baseMatProps.spread = 180.0;
          baseMatProps.initial_velocity_min = is3d ? 0.5 : 40.0;
          baseMatProps.initial_velocity_max = is3d ? 2.0 : 120.0;
          baseMatProps.gravity = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? 0 : -30,
            z: 0,
          };
          baseMatProps.scale_min = 0.2;
          baseMatProps.scale_max = 0.7;
          baseMatProps.color = {
            $type: 'Color',
            r: 0.7,
            g: 0.3,
            b: 1.0,
            a: 1.0,
          };
        } else if (presetKey === 'blood') {
          baseNodeProps.amount = 160;
          baseNodeProps.lifetime = 1.2;
          baseNodeProps.one_shot = true;
          baseMatProps.spread = 120.0;
          baseMatProps.initial_velocity_min = is3d ? 2.0 : 80.0;
          baseMatProps.initial_velocity_max = is3d ? 6.0 : 220.0;
          baseMatProps.gravity = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? -15 : 800,
            z: 0,
          };
          baseMatProps.scale_min = 0.05;
          baseMatProps.scale_max = 0.25;
          baseMatProps.color = {
            $type: 'Color',
            r: 0.8,
            g: 0.0,
            b: 0.0,
            a: 1.0,
          };
        } else if (presetKey === 'dust') {
          baseNodeProps.amount = 120;
          baseNodeProps.lifetime = 2.5;
          baseMatProps.direction = { $type: 'Vector3', x: 0, y: 1, z: 0 };
          baseMatProps.spread = 45.0;
          baseMatProps.initial_velocity_min = is3d ? 0.4 : 15.0;
          baseMatProps.initial_velocity_max = is3d ? 1.2 : 35.0;
          baseMatProps.gravity = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? 0.2 : -10,
            z: 0,
          };
          baseMatProps.scale_min = 0.6;
          baseMatProps.scale_max = 1.6;
          baseMatProps.color = {
            $type: 'Color',
            r: 0.6,
            g: 0.5,
            b: 0.35,
            a: 0.5,
          };
        } else if (presetKey === 'leaves') {
          baseNodeProps.amount = 80;
          baseNodeProps.lifetime = 3.0;
          baseMatProps.direction = {
            $type: 'Vector3',
            x: 0.2,
            y: is3d ? -1 : 1,
            z: 0.2,
          };
          baseMatProps.spread = 25.0;
          baseMatProps.initial_velocity_min = is3d ? 0.5 : 30.0;
          baseMatProps.initial_velocity_max = is3d ? 2.0 : 80.0;
          baseMatProps.gravity = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? -3 : 250,
            z: 0,
          };
          baseMatProps.scale_min = 0.2;
          baseMatProps.scale_max = 0.7;
          baseMatProps.color = {
            $type: 'Color',
            r: 0.2,
            g: 0.6,
            b: 0.2,
            a: 1.0,
          };
        } else {
          // fire (default)
          baseNodeProps.amount = 96;
          baseNodeProps.lifetime = 1.6;
          baseMatProps.direction = { $type: 'Vector3', x: 0, y: 1, z: 0 };
          baseMatProps.spread = 15.0;
          baseMatProps.initial_velocity_min = is3d ? 2.0 : 50.0;
          baseMatProps.initial_velocity_max = is3d ? 4.0 : 100.0;
          baseMatProps.gravity = {
            $type: 'Vector3',
            x: 0,
            y: is3d ? 2 : -50,
            z: 0,
          };
          baseMatProps.scale_min = 0.5;
          baseMatProps.scale_max = 1.5;
          baseMatProps.color = {
            $type: 'Color',
            r: 1.0,
            g: 0.5,
            b: 0.1,
            a: 1.0,
          };
        }

        const processMaterial = {
          $resource: 'ParticleProcessMaterial',
          props: baseMatProps,
        };

        const props: Record<string, unknown> = {
          ...baseNodeProps,
          process_material: processMaterial,
        };

        if (is3d) {
          props.draw_pass_1 = {
            $resource: 'QuadMesh',
            props: { size: { $type: 'Vector2', x: 0.5, y: 0.5 } },
          };
        }

        const resp = await callBaseTool(baseHandlers, 'godot_scene_manager', {
          action: 'create',
          nodeType,
          nodeName,
          parentNodePath,
          ensureUniqueName,
          dimension: is3d ? '3d' : '2d',
          props,
          ...(projectPath ? { projectPath } : {}),
          ...(scenePath ? { scenePath } : {}),
        });

        return {
          ok: resp.ok,
          summary: resp.ok
            ? 'create_particle_effect completed'
            : 'create_particle_effect failed',
          details: {
            preset: presetKey,
            is3d,
            oneShot,
            emitting,
            response: resp,
          },
          logs: resp.logs,
        };
      }

      if (action === 'generate_terrain_mesh') {
        const nodeName =
          typeof argsObj.nodeName === 'string' && argsObj.nodeName.trim()
            ? argsObj.nodeName.trim()
            : 'Terrain';
        const size =
          asOptionalNumber((argsObj as Record<string, unknown>).size, 'size') ??
          32;

        const heightScale =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).heightScale,
            'heightScale',
          ) ??
          asOptionalNumber(
            (argsObj as Record<string, unknown>).height_scale,
            'height_scale',
          ) ??
          5.0;
        const seed =
          asOptionalNumber((argsObj as Record<string, unknown>).seed, 'seed') ??
          0;
        const frequency =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).frequency,
            'frequency',
          ) ?? 0.02;
        const octaves =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).octaves,
            'octaves',
          ) ?? 4;
        const center =
          asOptionalBoolean(
            (argsObj as Record<string, unknown>).center,
            'center',
          ) ?? true;

        if (ctx.getEditorClient()?.isConnected) {
          const rpcParams: Record<string, unknown> = {
            parent_path: parentNodePath,
            name: nodeName,
            ensure_unique_name: ensureUniqueName,
            size,
            height_scale: heightScale,
            seed,
            frequency,
            octaves,
            center,
          };

          assertEditorRpcAllowed(
            'terrain.generate_mesh',
            rpcParams,
            ctx.getEditorProjectPath() ?? '',
          );

          const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
            request_json: {
              method: 'terrain.generate_mesh',
              params: rpcParams,
            },
          });

          return {
            ok: resp.ok,
            summary: resp.ok
              ? 'generate_terrain_mesh completed'
              : 'generate_terrain_mesh failed',
            details: {
              nodeName,
              parentNodePath,
              size,
              heightScale,
              seed,
              frequency,
              octaves,
              center,
              response: resp,
            },
            logs: resp.logs,
          };
        }

        if (!projectPath || !scenePath) {
          return {
            ok: false,
            summary:
              'generate_terrain_mesh requires projectPath + scenePath for headless mode',
            details: {
              required: ['projectPath', 'scenePath'],
              suggestions: [
                'Connect to the editor bridge (godot_workspace_manager(action="connect")) to generate terrain in the open scene.',
                'Or pass projectPath + scenePath to generate terrain headlessly (modifies the scene file).',
              ],
            },
          };
        }

        const resp = await callBaseTool(baseHandlers, 'godot_headless_op', {
          projectPath,
          operation: 'generate_terrain_mesh',
          params: {
            scenePath,
            parentNodePath,
            nodeName,
            ensureUniqueName,
            size,
            heightScale,
            seed,
            frequency,
            octaves,
            center,
          },
        });

        return {
          ok: resp.ok,
          summary: resp.ok
            ? 'generate_terrain_mesh completed (headless)'
            : 'generate_terrain_mesh failed (headless)',
          details: {
            projectPath,
            scenePath,
            nodeName,
            parentNodePath,
            size,
            heightScale,
            seed,
            frequency,
            octaves,
            center,
            response: resp,
          },
          logs: resp.logs,
        };
      }

      if (action === 'create_terrain_material') {
        const projectPathRequired =
          typeof argsObj.projectPath === 'string' && argsObj.projectPath.trim()
            ? argsObj.projectPath.trim()
            : null;
        if (!projectPathRequired) {
          return {
            ok: false,
            summary: 'create_terrain_material requires projectPath',
            details: { required: ['projectPath'] },
          };
        }
        ctx.assertValidProject(projectPathRequired);

        const shaderPath =
          asOptionalString(
            (argsObj as Record<string, unknown>).shaderPath,
            'shaderPath',
          )?.trim() ??
          asOptionalString(
            (argsObj as Record<string, unknown>).path,
            'path',
          )?.trim() ??
          'res://terrain_material.gdshader';
        const materialType =
          asOptionalString(
            (argsObj as Record<string, unknown>).type,
            'type',
          )?.trim() ?? 'height_blend';
        const textureScale =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).textureScale ??
              (argsObj as Record<string, unknown>).texture_scale,
            'textureScale',
          ) ?? 0.1;
        const blendSharpness =
          asOptionalNumber(
            (argsObj as Record<string, unknown>).blendSharpness ??
              (argsObj as Record<string, unknown>).blend_sharpness,
            'blendSharpness',
          ) ?? 2.0;
        const heightLevels =
          asOptionalString(
            (argsObj as Record<string, unknown>).heightLevels ??
              (argsObj as Record<string, unknown>).height_levels,
            'heightLevels',
          )?.trim() ?? '0.0,0.3,0.6,1.0';

        if (!shaderPath.endsWith('.gdshader')) {
          return {
            ok: false,
            summary:
              'create_terrain_material requires shaderPath ending with .gdshader',
            details: { shaderPath },
          };
        }

        const shaderCode = generateTerrainShader({
          type: materialType,
          textureScale,
          blendSharpness,
          heightLevels,
        });

        const steps: ToolResponse[] = [];
        const writeResp = await callBaseTool(
          baseHandlers,
          'godot_code_manager',
          {
            action: 'shader.create',
            projectPath: projectPathRequired,
            shaderPath,
            content: shaderCode,
          },
        );
        steps.push(writeResp);
        if (!writeResp.ok) return writeResp;

        const scanResp = await callBaseTool(
          baseHandlers,
          'godot_asset_manager',
          {
            action: 'scan',
            projectPath: projectPathRequired,
          },
        );
        steps.push(scanResp);

        return {
          ok: scanResp.ok,
          summary: scanResp.ok
            ? 'create_terrain_material completed'
            : 'create_terrain_material completed (scan failed)',
          details: {
            shaderPath,
            type: materialType,
            textureScale,
            blendSharpness,
            heightLevels,
            steps,
          },
          logs: [...(writeResp.logs ?? []), ...(scanResp.logs ?? [])],
        };
      }

      const nodeName =
        typeof argsObj.nodeName === 'string' && argsObj.nodeName.trim()
          ? argsObj.nodeName.trim()
          : null;
      if (!nodeName) {
        return {
          ok: false,
          summary: `${action} requires nodeName`,
          details: { required: ['nodeName'] },
        };
      }

      const dimension = inferredDimension(action, argsObj);
      const providedBodyType =
        typeof argsObj.bodyType === 'string' && argsObj.bodyType.trim()
          ? argsObj.bodyType.trim()
          : null;
      const defaultBodyType =
        action === 'create_primitive'
          ? dimension === '2d'
            ? 'StaticBody2D'
            : 'StaticBody3D'
          : dimension === '2d'
            ? 'RigidBody2D'
            : 'RigidBody3D';
      const bodyType = providedBodyType ?? defaultBodyType;

      const providedShapePreset =
        typeof argsObj.shapePreset === 'string' && argsObj.shapePreset.trim()
          ? argsObj.shapePreset.trim()
          : typeof (argsObj as Record<string, unknown>).shape === 'string' &&
              String((argsObj as Record<string, unknown>).shape).trim()
            ? String((argsObj as Record<string, unknown>).shape).trim()
            : null;
      const shapePreset =
        action === 'create_trigger_area' && !providedShapePreset
          ? dimension === '2d'
            ? 'rect'
            : 'box'
          : providedShapePreset;

      const nodeType =
        action === 'create_trigger_area'
          ? dimension === '2d'
            ? 'Area2D'
            : 'Area3D'
          : bodyType;

      const forwardedArgs: Record<string, unknown> = {
        action: 'create',
        nodeType,
        nodeName,
        parentNodePath,
        ensureUniqueName,
        dimension,
        ...(typeof argsObj.primitive === 'string'
          ? { primitive: argsObj.primitive }
          : {}),
        ...(typeof argsObj.meshPreset === 'string'
          ? { meshPreset: argsObj.meshPreset }
          : {}),
        ...(shapePreset ? { shapePreset } : {}),
        ...(typeof argsObj.collisionLayer === 'number'
          ? { collisionLayer: argsObj.collisionLayer }
          : {}),
        ...(typeof argsObj.collisionMask === 'number'
          ? { collisionMask: argsObj.collisionMask }
          : {}),
        ...(projectPath ? { projectPath } : {}),
        ...(scenePath ? { scenePath } : {}),
      };

      if (action === 'create_rigidbody') {
        if (
          shapePreset &&
          typeof argsObj.primitive !== 'string' &&
          typeof argsObj.meshPreset !== 'string'
        ) {
          forwardedArgs.primitive = shapePreset;
        }
      }

      if (action === 'create_rigidbody' || action === 'create_trigger_area') {
        forwardedArgs.shapeNodeName =
          dimension === '2d' ? 'CollisionShape2D' : 'CollisionShape3D';
      }

      if (action === 'create_rigidbody') {
        forwardedArgs.meshNodeName = dimension === '2d' ? 'Sprite2D' : 'Mesh';

        const mass = parseNumberLike((argsObj as Record<string, unknown>).mass);
        const size = parseNumberLike((argsObj as Record<string, unknown>).size);
        const color = parseColorLike(
          (argsObj as Record<string, unknown>).color,
        );

        const props: Record<string, unknown> = {};
        if (mass !== null) props.mass = mass;
        if (Object.keys(props).length > 0) forwardedArgs.props = props;

        if (dimension === '3d' && size !== null) {
          const key = (shapePreset ?? 'box').trim().toLowerCase();
          const meshSpec: Record<string, unknown> | null =
            key === 'box'
              ? {
                  $resource: 'BoxMesh',
                  props: { size: defaultVector3(size, size, size) },
                }
              : key === 'sphere'
                ? {
                    $resource: 'SphereMesh',
                    props: { radius: size / 2.0, height: size },
                  }
                : key === 'capsule'
                  ? {
                      $resource: 'CapsuleMesh',
                      props: { radius: size / 3.0, height: size },
                    }
                  : key === 'cylinder'
                    ? {
                        $resource: 'CylinderMesh',
                        props: {
                          top_radius: size / 2.0,
                          bottom_radius: size / 2.0,
                          height: size,
                        },
                      }
                    : key === 'plane' || key === 'quad'
                      ? {
                          $resource: 'PlaneMesh',
                          props: { size: defaultVector2(size, size) },
                        }
                      : null;

          const shapeSpec: Record<string, unknown> | null =
            key === 'box'
              ? {
                  $resource: 'BoxShape3D',
                  props: { size: defaultVector3(size, size, size) },
                }
              : key === 'sphere'
                ? { $resource: 'SphereShape3D', props: { radius: size / 2.0 } }
                : key === 'capsule'
                  ? {
                      $resource: 'CapsuleShape3D',
                      props: { radius: size / 3.0, height: size },
                    }
                  : key === 'cylinder'
                    ? {
                        $resource: 'CylinderShape3D',
                        props: { radius: size / 2.0, height: size },
                      }
                    : key === 'plane' || key === 'quad'
                      ? {
                          $resource: 'BoxShape3D',
                          props: { size: defaultVector3(size, 0.1, size) },
                        }
                      : null;

          if (meshSpec) forwardedArgs.mesh = meshSpec;
          if (shapeSpec) forwardedArgs.shape = shapeSpec;
        }

        if (dimension === '3d' && color) {
          forwardedArgs.meshProps = {
            material_override: {
              $resource: 'StandardMaterial3D',
              props: {
                albedo_color: color,
                transparency: 1,
              },
            },
          };
        }
      }

      const resp = await callBaseTool(
        baseHandlers,
        'godot_scene_manager',
        forwardedArgs,
      );

      if (action === 'create_trigger_area') {
        const debugMesh =
          asOptionalBoolean(
            (argsObj as Record<string, unknown>).debugMesh ??
              (argsObj as Record<string, unknown>).showDebug ??
              (argsObj as Record<string, unknown>).show_debug,
            'debugMesh',
          ) ?? false;

        const areaPath = resp.ok ? extractNodePath(resp) : null;
        const size = parseNumberLike((argsObj as Record<string, unknown>).size);
        const presetKey = (shapePreset ?? 'box').trim().toLowerCase();

        if (debugMesh && resp.ok && areaPath && dimension === '3d') {
          const meshSpec: Record<string, unknown> | null =
            presetKey === 'box'
              ? {
                  $resource: 'BoxMesh',
                  props: {
                    size: defaultVector3(size ?? 1, size ?? 1, size ?? 1),
                  },
                }
              : presetKey === 'sphere'
                ? {
                    $resource: 'SphereMesh',
                    props: { radius: (size ?? 1) / 2.0, height: size ?? 1 },
                  }
                : presetKey === 'capsule'
                  ? {
                      $resource: 'CapsuleMesh',
                      props: { radius: (size ?? 1) / 3.0, height: size ?? 1 },
                    }
                  : presetKey === 'cylinder'
                    ? {
                        $resource: 'CylinderMesh',
                        props: {
                          top_radius: (size ?? 1) / 2.0,
                          bottom_radius: (size ?? 1) / 2.0,
                          height: size ?? 1,
                        },
                      }
                    : presetKey === 'plane' || presetKey === 'quad'
                      ? {
                          $resource: 'PlaneMesh',
                          props: { size: defaultVector2(size ?? 1, size ?? 1) },
                        }
                      : {
                          $resource: 'BoxMesh',
                          props: {
                            size: defaultVector3(
                              size ?? 1,
                              size ?? 1,
                              size ?? 1,
                            ),
                          },
                        };

          await callBaseTool(baseHandlers, 'godot_scene_manager', {
            action: 'create',
            nodeType: 'MeshInstance3D',
            nodeName: 'DebugMesh',
            parentNodePath: areaPath,
            ensureUniqueName: true,
            dimension: '3d',
            ...(meshSpec ? { mesh: meshSpec } : {}),
            meshNodeName: 'DebugMesh',
            props: {
              material_override: {
                $resource: 'StandardMaterial3D',
                props: {
                  albedo_color: {
                    $type: 'Color',
                    r: 0.2,
                    g: 0.8,
                    b: 0.2,
                    a: 0.3,
                  },
                  transparency: 1,
                },
              },
            },
            ...(projectPath ? { projectPath } : {}),
            ...(scenePath ? { scenePath } : {}),
          });
        }
      }

      return {
        ok: resp.ok,
        summary: resp.ok ? `${action} completed` : `${action} failed`,
        details: { response: resp },
        logs: resp.logs,
      };
    },
  };
}
