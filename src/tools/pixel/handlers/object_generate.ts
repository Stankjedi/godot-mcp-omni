import fs from 'fs/promises';
import path from 'path';

import { resolveInsideProject } from '../../../security.js';
import {
  ValidationError,
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalString,
  asRecord,
  valueType,
} from '../../../validation.js';

import { runAseprite } from '../../../pipeline/aseprite_runner.js';
import { generatePlaceholderSpriteRgba } from '../../../pipeline/pixel_image.js';
import { writePngRgba } from '../../../pipeline/png.js';
import type {
  PixelManifestStep,
  PixelProjectProfile,
} from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';
import type { BaseToolHandlers } from '../../unified/shared.js';

import { fileExists, readJsonIfExists } from '../files.js';
import { nowIso } from '../manifest.js';
import { normalizeResPath } from '../paths.js';
import {
  parseObjectAnimationInput,
  parseObjectPlacementInput,
  parseRepresentation,
  parseSizePx,
} from '../spec.js';
import {
  frameTagsFromAsepriteJson,
  firstFrameRectFromAsepriteJson,
} from '../tiles.js';

import {
  analyzePixelProjectForTool,
  externalToolsAllowed,
  forceRegenerateBlocked,
  overwriteAllowed,
  requireToolHandler,
} from './shared.js';

type GeneratedObject = {
  id: string;
  kind: string;
  representation: 'tile' | 'scene';
  spritePngPath: string;
  spriteAsepriteJsonPath?: string;
  spriteFramesPath?: string;
  scenePath?: string;
  defaultAnimation?: string;
  animations?: string[];
};

type ObjectGenerateOutputs = {
  objects: GeneratedObject[];
};

export async function runObjectGenerate(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
): Promise<{
  response: ToolResponse;
  outputs?: ObjectGenerateOutputs;
  step: PixelManifestStep;
  profile: PixelProjectProfile;
}> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
  const spec = asRecord(argsObj.spec, 'spec');
  const allowExternalTools =
    asOptionalBoolean(argsObj.allowExternalTools, 'allowExternalTools') ??
    false;
  const forceRegenerate =
    asOptionalBoolean(argsObj.forceRegenerate, 'forceRegenerate') ?? false;
  const imageGenModeRaw = asOptionalString(
    argsObj.imageGenMode,
    'imageGenMode',
  )?.trim();
  const imageGenMode =
    imageGenModeRaw && imageGenModeRaw.length > 0 ? imageGenModeRaw : 'auto';
  if (imageGenMode !== 'auto' && imageGenMode !== 'manual_drop') {
    throw new ValidationError(
      'imageGenMode',
      'Invalid field "imageGenMode": expected "auto" or "manual_drop"',
      valueType(argsObj.imageGenMode),
    );
  }

  const startedAt = nowIso();
  const profile = await analyzePixelProjectForTool(ctx, projectPath);

  if (!overwriteAllowed(forceRegenerate)) {
    const response = forceRegenerateBlocked('pixel_object_generate');
    return {
      response,
      step: {
        name: 'pixel_object_generate',
        startedAt,
        finishedAt: nowIso(),
        ok: false,
        summary: response.summary,
        details: response.details,
      },
      profile,
    };
  }

  const objectsValue = (spec as Record<string, unknown>).objects;
  if (!Array.isArray(objectsValue)) {
    throw new ValidationError(
      'spec.objects',
      `Invalid field "spec.objects": expected array, got ${valueType(objectsValue)}`,
      valueType(objectsValue),
    );
  }

  const outObjects: GeneratedObject[] = [];
  const batchSteps: Array<{
    operation: string;
    params: Record<string, unknown>;
  }> = [];

  const exportedAseprite: Array<Record<string, unknown>> = [];

  for (let i = 0; i < objectsValue.length; i += 1) {
    const obj = asRecord(objectsValue[i], `spec.objects[${i}]`);
    const id = asNonEmptyString(obj.id ?? obj.name, `spec.objects[${i}].id`);
    const kind = (
      asOptionalString(obj.kind, `spec.objects[${i}].kind`) ?? 'object'
    ).trim();
    const asepritePathRaw = asOptionalString(
      obj.asepritePath ?? obj.sourceAsepritePath ?? obj.source_aseprite_path,
      `spec.objects[${i}].asepritePath`,
    )?.trim();
    const asepritePath = asepritePathRaw
      ? normalizeResPath(asepritePathRaw)
      : undefined;
    const representation = parseRepresentation(
      obj.representation,
      `spec.objects[${i}].representation`,
    );
    const animation = parseObjectAnimationInput(
      obj.animation,
      `spec.objects[${i}].animation`,
    );
    const animationFps = animation?.fps ?? 8;
    const animationLoop = animation?.loop ?? true;

    const sizePx = parseSizePx(
      obj.sizePx ?? obj.size_px,
      `spec.objects[${i}].sizePx`,
      {
        w: 32,
        h: 32,
      },
    );
    const w = sizePx.w;
    const h = sizePx.h;

    void parseObjectPlacementInput(
      obj.placement,
      `spec.objects[${i}].placement`,
    );
    if (animation && representation !== 'scene') {
      const response: ToolResponse = {
        ok: false,
        summary: 'Object animation requires representation="scene"',
        details: {
          object: id,
          representation,
          suggestions: [
            'Set objects[].representation="scene" to generate an AnimatedSprite2D scene.',
            'Or set objects[].animation.enabled=false to generate a static Sprite2D scene.',
          ],
        },
      };
      return {
        response,
        step: {
          name: 'pixel_object_generate',
          startedAt,
          finishedAt: nowIso(),
          ok: false,
          summary: response.summary,
          details: response.details,
        },
        profile,
      };
    }

    const spritePngPath = normalizeResPath(
      `res://assets/generated/sprites/${id}/${id}.png`,
    );
    const spriteAsepriteJsonPath = normalizeResPath(
      `res://assets/generated/sprites/${id}/${id}.aseprite.json`,
    );
    const spriteAbs = resolveInsideProject(projectPath, spritePngPath);
    const spriteAsepriteJsonAbs = resolveInsideProject(
      projectPath,
      spriteAsepriteJsonPath,
    );
    const spriteExists = await fileExists(spriteAbs);
    const spriteAsepriteJsonExists = await fileExists(spriteAsepriteJsonAbs);
    const spriteFramesPath = animation
      ? normalizeResPath(
          `res://assets/generated/sprites/${id}/${id}.sprite_frames.tres`,
        )
      : undefined;
    const spriteFramesAbs = spriteFramesPath
      ? resolveInsideProject(projectPath, spriteFramesPath)
      : null;
    const spriteFramesExists = spriteFramesAbs
      ? await fileExists(spriteFramesAbs)
      : false;
    let asepriteJson: unknown | null = null;
    let didAsepriteExport = false;
    let asepriteFrameRect: {
      x: number;
      y: number;
      w: number;
      h: number;
    } | null = null;
    if ((!spriteExists || forceRegenerate) && asepritePath) {
      if (!externalToolsAllowed(allowExternalTools)) {
        const response: ToolResponse = {
          ok: false,
          summary:
            'Aseprite source provided but external tools are not enabled (ALLOW_EXTERNAL_TOOLS!=true)',
          details: {
            object: id,
            asepritePath,
            suggestions: [
              'Set allowExternalTools=true and ALLOW_EXTERNAL_TOOLS=true to enable Aseprite export.',
              'Or omit objects[].asepritePath to use the builtin placeholder sprite generator.',
            ],
          },
        };
        return {
          response,
          step: {
            name: 'pixel_object_generate',
            startedAt,
            finishedAt: nowIso(),
            ok: false,
            summary: response.summary,
            details: response.details,
          },
          profile,
        };
      }

      const absInput = resolveInsideProject(projectPath, asepritePath);
      await fs.mkdir(path.dirname(spriteAbs), { recursive: true });
      await fs.mkdir(path.dirname(spriteAsepriteJsonAbs), { recursive: true });

      const baseArgs: string[] = [
        '-b',
        absInput,
        '--sheet',
        spriteAbs,
        '--data',
        spriteAsepriteJsonAbs,
        '--format',
        'json-array',
      ];
      const extraListFlags = ['--list-slices', '--list-tags', '--list-layers'];
      let exportResult = await runAseprite([...baseArgs, ...extraListFlags], {
        cwd: projectPath,
        timeoutMs: 120_000,
      });
      if (!exportResult.ok) {
        const stderrLower = exportResult.stderr.toLowerCase();
        const looksUnsupportedFlag =
          stderrLower.includes('unknown option') ||
          stderrLower.includes('unrecognized option') ||
          stderrLower.includes('unknown argument') ||
          stderrLower.includes('unknown parameter');
        if (looksUnsupportedFlag) {
          exportResult = await runAseprite(baseArgs, {
            cwd: projectPath,
            timeoutMs: 120_000,
          });
        }
      }

      exportedAseprite.push({
        id,
        asepritePath,
        ok: exportResult.ok,
        summary: exportResult.summary,
        command: exportResult.command,
        args: exportResult.args,
        exitCode: exportResult.exitCode,
        durationMs: exportResult.durationMs,
        attemptedCandidates: exportResult.attemptedCandidates,
        capabilities: exportResult.capabilities,
        suggestions: exportResult.suggestions,
      });

      if (!exportResult.ok) {
        const response: ToolResponse = {
          ok: false,
          summary: exportResult.summary,
          details: {
            object: id,
            asepritePath,
            export: exportedAseprite.at(-1),
            suggestions: [
              ...(exportResult.suggestions ?? []),
              'Run aseprite_doctor to check detection and supported flags.',
            ],
          },
        };
        return {
          response,
          step: {
            name: 'pixel_object_generate',
            startedAt,
            finishedAt: nowIso(),
            ok: false,
            summary: response.summary,
            details: response.details,
          },
          profile,
        };
      }

      didAsepriteExport = true;
      asepriteJson = await readJsonIfExists(spriteAsepriteJsonAbs);
      asepriteFrameRect = firstFrameRectFromAsepriteJson(asepriteJson);
    } else if (
      !spriteExists ||
      (forceRegenerate && imageGenMode !== 'manual_drop')
    ) {
      if (imageGenMode === 'manual_drop') {
        const response: ToolResponse = {
          ok: false,
          summary: 'ManualDrop sprite PNG is missing',
          details: {
            object: id,
            requiredFiles: [spritePngPath],
            expectedSizePx: { width: w, height: h },
            suggestions: [
              `Add a PNG at ${spritePngPath} (expected size: ${w}x${h}).`,
              'Re-run pixel_object_generate with the same spec once the file exists.',
              'Or omit imageGenMode/manual_drop to use the builtin placeholder generator.',
            ],
          },
        };
        return {
          response,
          step: {
            name: 'pixel_object_generate',
            startedAt,
            finishedAt: nowIso(),
            ok: false,
            summary: response.summary,
            details: response.details,
          },
          profile,
        };
      }

      const sprite = generatePlaceholderSpriteRgba({
        width: w,
        height: h,
        seed: i + 100,
      });
      await writePngRgba(spriteAbs, sprite.width, sprite.height, sprite.rgba);
    }

    let defaultAnimation: string | undefined;
    let animations: string[] | undefined;
    if (animation) {
      if (!spriteFramesPath) {
        const response: ToolResponse = {
          ok: false,
          summary: 'Internal error: spriteFramesPath missing',
          details: { object: id },
        };
        return {
          response,
          step: {
            name: 'pixel_object_generate',
            startedAt,
            finishedAt: nowIso(),
            ok: false,
            summary: response.summary,
            details: response.details,
          },
          profile,
        };
      }

      asepriteJson =
        asepriteJson ?? (await readJsonIfExists(spriteAsepriteJsonAbs));
      if (!asepriteJson) {
        const response: ToolResponse = {
          ok: false,
          summary:
            'Animation enabled but Aseprite JSON export is missing or invalid',
          details: {
            object: id,
            asepriteJsonPath: spriteAsepriteJsonPath,
            suggestions: [
              'Provide objects[].asepritePath and enable allowExternalTools=true + ALLOW_EXTERNAL_TOOLS=true to export the spritesheet JSON.',
              `Ensure ${spriteAsepriteJsonPath} exists inside the project.`,
              'Or set objects[].animation.enabled=false to use the static sprite workflow.',
            ],
          },
        };
        return {
          response,
          step: {
            name: 'pixel_object_generate',
            startedAt,
            finishedAt: nowIso(),
            ok: false,
            summary: response.summary,
            details: response.details,
          },
          profile,
        };
      }

      const tags = frameTagsFromAsepriteJson(asepriteJson);
      const names: string[] = [];
      const seen = new Set<string>();
      for (const tag of tags) {
        const key = tag.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(tag.name);
      }
      if (names.length === 0) {
        const response: ToolResponse = {
          ok: false,
          summary:
            'Animation enabled but no frameTags were found in Aseprite JSON',
          details: {
            object: id,
            asepriteJsonPath: spriteAsepriteJsonPath,
            suggestions: [
              'Add at least one frame tag in Aseprite (e.g. "idle").',
              'Re-export with --list-tags support enabled (aseprite_doctor can confirm capabilities).',
              'Or set objects[].animation.enabled=false to use the static sprite workflow.',
            ],
          },
        };
        return {
          response,
          step: {
            name: 'pixel_object_generate',
            startedAt,
            finishedAt: nowIso(),
            ok: false,
            summary: response.summary,
            details: response.details,
          },
          profile,
        };
      }

      animations = names;
      const requestedDefault = animation.defaultTag?.trim().toLowerCase();
      if (requestedDefault && seen.has(requestedDefault)) {
        defaultAnimation = names.find(
          (name) => name.toLowerCase() === requestedDefault,
        );
      } else if (seen.has('idle')) {
        defaultAnimation = names.find((name) => name.toLowerCase() === 'idle');
      } else {
        defaultAnimation = names[0];
      }

      if (!defaultAnimation) defaultAnimation = names[0];

      if (!spriteFramesExists || forceRegenerate) {
        batchSteps.push({
          operation: 'op_spriteframes_from_aseprite_json',
          params: {
            spritesheetPngPath: spritePngPath,
            asepriteJsonPath: spriteAsepriteJsonPath,
            spriteFramesPath,
            fps: animationFps,
            loop: animationLoop,
          },
        });
      }
    }

    let scenePath: string | undefined;
    if (representation === 'scene') {
      scenePath = normalizeResPath(`res://scenes/generated/props/${id}.tscn`);
      const sceneAbs = resolveInsideProject(projectPath, scenePath);
      const sceneExists = await fileExists(sceneAbs);
      if (!sceneExists || forceRegenerate) {
        batchSteps.push({
          operation: 'create_scene',
          params: {
            scenePath,
            rootNodeType: 'Node2D',
            root_node_type: 'Node2D',
          },
        });

        if (animation) {
          if (!spriteFramesPath) {
            const response: ToolResponse = {
              ok: false,
              summary: 'Internal error: spriteFramesPath missing',
              details: { object: id },
            };
            return {
              response,
              step: {
                name: 'pixel_object_generate',
                startedAt,
                finishedAt: nowIso(),
                ok: false,
                summary: response.summary,
                details: response.details,
              },
              profile,
            };
          }

          batchSteps.push({
            operation: 'add_node',
            params: {
              scenePath,
              parentNodePath: 'root',
              nodeType: 'AnimatedSprite2D',
              nodeName: 'Sprite',
            },
          });
          batchSteps.push({
            operation: 'set_node_properties',
            params: {
              scenePath,
              nodePath: 'root/Sprite',
              props: {
                sprite_frames: { $resource: spriteFramesPath },
                animation: defaultAnimation,
              },
            },
          });
          batchSteps.push({ operation: 'save_scene', params: { scenePath } });
        } else {
          if (!asepriteFrameRect && asepritePath && spriteAsepriteJsonExists) {
            asepriteJson =
              asepriteJson ?? (await readJsonIfExists(spriteAsepriteJsonAbs));
            asepriteFrameRect = firstFrameRectFromAsepriteJson(asepriteJson);
          }

          batchSteps.push({
            operation: 'add_node',
            params: {
              scenePath,
              parentNodePath: 'root',
              nodeType: 'Sprite2D',
              nodeName: 'Sprite',
            },
          });
          batchSteps.push({
            operation: 'load_sprite',
            params: {
              scenePath,
              nodePath: 'root/Sprite',
              texturePath: spritePngPath,
            },
          });
          if (asepriteFrameRect) {
            batchSteps.push({
              operation: 'set_node_properties',
              params: {
                scenePath,
                nodePath: 'root/Sprite',
                props: {
                  region_enabled: true,
                  region_rect: {
                    $type: 'Rect2',
                    x: asepriteFrameRect.x,
                    y: asepriteFrameRect.y,
                    w: asepriteFrameRect.w,
                    h: asepriteFrameRect.h,
                  },
                },
              },
            });
          }
          batchSteps.push({ operation: 'save_scene', params: { scenePath } });
        }
      }
    }

    outObjects.push({
      id,
      kind,
      representation,
      spritePngPath,
      spriteAsepriteJsonPath:
        didAsepriteExport || spriteAsepriteJsonExists || animation
          ? spriteAsepriteJsonPath
          : undefined,
      spriteFramesPath: animation ? spriteFramesPath : undefined,
      scenePath,
      defaultAnimation: animation ? defaultAnimation : undefined,
      animations: animation ? animations : undefined,
    });
  }

  let batchResp: ToolResponse | null = null;
  if (batchSteps.length > 0) {
    const batch = requireToolHandler(baseHandlers, 'godot_headless_batch');
    batchResp = await batch({
      projectPath,
      steps: batchSteps,
      stopOnError: true,
    });
    if (!batchResp.ok) {
      const step: PixelManifestStep = {
        name: 'pixel_object_generate',
        startedAt,
        finishedAt: nowIso(),
        ok: false,
        summary: batchResp.summary,
        details: { ...(batchResp.details ?? {}), objects: outObjects },
      };
      return { response: batchResp, step, profile };
    }
  }

  const outputs: ObjectGenerateOutputs = { objects: outObjects };
  const response: ToolResponse = {
    ok: true,
    summary: 'Objects generated',
    details: { output: outputs, batch: batchResp },
  };

  const step: PixelManifestStep = {
    name: 'pixel_object_generate',
    startedAt,
    finishedAt: nowIso(),
    ok: true,
    summary: response.summary,
    details: {
      ...(response.details as Record<string, unknown>),
      allowExternalTools,
      asepriteExports:
        exportedAseprite.length > 0 ? exportedAseprite : undefined,
    },
  };

  return { response, outputs, step, profile };
}
