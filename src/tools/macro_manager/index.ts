import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { resolveInsideProject } from '../../security.js';
import {
  readMacroManifest,
  writeMacroManifest,
  type MacroManifest,
} from '../../pipeline/macro_manifest.js';
import { readPixelManifest } from '../../pipeline/pixel_manifest.js';
import {
  ValidationError,
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalString,
  asRecord,
  valueType,
} from '../../validation.js';

import type { ServerContext } from '../context.js';
import type { ToolHandler, ToolResponse } from '../types.js';
import {
  callBaseTool,
  normalizeAction,
  supportedActionError,
  type BaseToolHandlers,
} from '../unified/shared.js';

import { buildComposeMainSceneOps } from './compose_main_scene.js';
import { getMacro, getMacroList } from './macros.js';
import { opValidateScene } from './ops.js';
import {
  asOptionalArray,
  guessPixelWorldScenePath,
  parseMacroIds,
  parsePixelMacroConfig,
} from './parsing.js';
import { prepareMacroOps } from './prepare.js';
import { forceRegenerateBlocked, nowIso, overwriteAllowed } from './utils.js';
import type { MacroOp } from './types.js';

export function createMacroManagerToolHandlers(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): Record<string, ToolHandler> {
  return {
    macro_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw);

      if (action === 'list_macros') {
        return {
          ok: true,
          summary: 'macro_manager: available macros',
          details: { macros: getMacroList() },
        };
      }

      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);

      if (action === 'describe_macro') {
        const macroId = asNonEmptyString(argsObj.macroId, 'macroId');
        const macro = getMacro(macroId);
        if (!macro) {
          return {
            ok: false,
            summary: `macro_manager: unknown macroId "${macroId}"`,
            details: { macroId, supportedMacros: getMacroList() },
          };
        }
        return {
          ok: true,
          summary: `macro_manager: ${macroId}`,
          details: {
            macro: {
              id: macro.id,
              title: macro.title,
              description: macro.description,
              outputs: macro.outputs,
            },
          },
        };
      }

      if (action === 'manifest_get') {
        const manifest = await readMacroManifest(projectPath);
        if (!manifest) {
          return {
            ok: false,
            summary: 'macro_manager: manifest not found',
            details: {
              manifestPath: 'res://.godot_mcp/macro_manifest.json',
              suggestions: ['Run macro_manager(action="run") first.'],
            },
          };
        }
        return {
          ok: true,
          summary: 'macro_manager: manifest loaded',
          details: {
            manifestPath: 'res://.godot_mcp/macro_manifest.json',
            manifest,
          },
        };
      }

      if (action === 'plan') {
        const pixel = parsePixelMacroConfig(argsObj);
        const macroIds = parseMacroIds(argsObj);
        if (!macroIds.length) {
          return {
            ok: false,
            summary: 'macro_manager: missing macroId/macros',
            details: {
              suggestions: [
                'Provide macroId (string) or macros (array of strings/objects).',
              ],
            },
          };
        }

        const plans: Array<{
          macroId: string;
          title: string;
          description: string;
          outputs: string[];
          operations: MacroOp[];
        }> = [];

        for (const id of macroIds) {
          const macro = getMacro(id);
          if (!macro) {
            return {
              ok: false,
              summary: `macro_manager: unknown macroId "${id}"`,
              details: { macroId: id, supportedMacros: getMacroList() },
            };
          }
          plans.push({
            macroId: macro.id,
            title: macro.title,
            description: macro.description,
            outputs: macro.outputs,
            operations: macro.buildOps(),
          });
        }

        return {
          ok: true,
          summary: 'macro_manager: plan generated',
          details: {
            ...(pixel
              ? {
                  pixel: {
                    tool: 'pixel_manager',
                    args: {
                      action: 'macro_run',
                      projectPath,
                      ...pixel,
                    },
                  },
                }
              : {}),
            plans,
            ...(asOptionalBoolean(argsObj.composeMainScene, 'composeMainScene')
              ? {
                  composeMainScene: {
                    mainScenePath: (() => {
                      return (
                        asOptionalString(
                          argsObj.mainScenePath,
                          'mainScenePath',
                        )?.trim() ?? 'res://scenes/generated/macro/Main.tscn'
                      );
                    })(),
                    worldScenePath: (() => {
                      return pixel
                        ? guessPixelWorldScenePath(pixel)
                        : 'res://scenes/generated/world/World.tscn';
                    })(),
                    operations: (() => {
                      const mainScenePath =
                        asOptionalString(
                          argsObj.mainScenePath,
                          'mainScenePath',
                        )?.trim() ?? 'res://scenes/generated/macro/Main.tscn';
                      const worldScenePath = pixel
                        ? guessPixelWorldScenePath(pixel)
                        : 'res://scenes/generated/world/World.tscn';

                      const wantsUi = macroIds.includes('ui_system_scaffold');
                      return buildComposeMainSceneOps(
                        worldScenePath,
                        mainScenePath,
                        {
                          includeHud: wantsUi,
                          includePauseMenu: wantsUi,
                          includeSaveManager:
                            macroIds.includes('save_load_scaffold'),
                          includeAudioManager: macroIds.includes(
                            'audio_system_scaffold',
                          ),
                          includeUiManager: wantsUi,
                        },
                      );
                    })(),
                  },
                }
              : {}),
          },
        };
      }

      if (action === 'validate') {
        const scenesValue = asOptionalArray(argsObj.scenes, 'scenes');
        const manifest = await readMacroManifest(projectPath);
        const scenes: string[] = [];

        if (scenesValue) {
          for (let i = 0; i < scenesValue.length; i += 1) {
            const s = scenesValue[i];
            if (typeof s !== 'string' || !s.trim()) {
              throw new ValidationError(
                `scenes[${i}]`,
                'Invalid scene path: expected non-empty string',
                valueType(s),
              );
            }
            scenes.push(s.trim());
          }
        } else if (manifest) {
          for (const m of manifest.macros) {
            for (const p of m.created) {
              if (p.endsWith('.tscn')) scenes.push(p);
            }
          }
        }

        if (!scenes.length) {
          return {
            ok: false,
            summary: 'macro_manager: no scenes to validate',
            details: {
              suggestions: [
                'Pass scenes=[...] or run macro_manager(action="run") first.',
              ],
            },
          };
        }

        await ctx.ensureGodotPath();
        const steps = scenes.map((p) => ({
          operation: 'validate_scene',
          params: { scenePath: p },
        }));

        const resp = await callBaseTool(baseHandlers, 'godot_headless_batch', {
          projectPath,
          steps,
          stopOnError: true,
        });

        return resp.ok
          ? {
              ok: true,
              summary: 'macro_manager: scenes validated',
              details: { scenes, response: resp.details },
              logs: resp.logs,
            }
          : resp;
      }

      if (action === 'resume') {
        const manifest = await readMacroManifest(projectPath);
        if (!manifest) {
          return {
            ok: false,
            summary: 'macro_manager: no manifest to resume',
            details: {
              suggestions: ['Run macro_manager(action="run") first.'],
            },
          };
        }
        const pending = manifest.macros
          .filter((m) => m.status !== 'done')
          .map((m) => m.macroId);
        if (!pending.length) {
          return {
            ok: true,
            summary: 'macro_manager: nothing to resume',
            details: { runId: manifest.runId },
          };
        }

        const nextArgs: Record<string, unknown> = {
          action: 'run',
          projectPath,
          macros: pending,
          forceRegenerate: false,
        };
        return await (
          await createMacroManagerToolHandlers(ctx, baseHandlers)
        ).macro_manager(nextArgs);
      }

      if (action !== 'run') {
        return supportedActionError('macro_manager', action, [
          'list_macros',
          'describe_macro',
          'plan',
          'run',
          'resume',
          'manifest_get',
          'validate',
        ]);
      }

      // run
      const pixel = parsePixelMacroConfig(argsObj);
      const macroIds = parseMacroIds(argsObj);
      if (!macroIds.length) {
        return {
          ok: false,
          summary: 'macro_manager: missing macroId/macros',
          details: {
            suggestions: [
              'Provide macroId (string) or macros (array of strings/objects).',
            ],
          },
        };
      }

      const forceRegenerateRequested =
        (asOptionalBoolean(argsObj.forceRegenerate, 'forceRegenerate') ??
          false) ||
        (pixel?.forceRegenerate ?? false);
      const forceRegenerate = forceRegenerateRequested;
      if (!overwriteAllowed(forceRegenerate)) {
        return forceRegenerateBlocked('macro_manager');
      }

      const dryRun = asOptionalBoolean(argsObj.dryRun, 'dryRun') ?? false;
      const doValidate =
        asOptionalBoolean(argsObj.validate, 'validate') ?? false;
      const composeMainScene =
        asOptionalBoolean(argsObj.composeMainScene, 'composeMainScene') ??
        false;
      const mainScenePath =
        asOptionalString(argsObj.mainScenePath, 'mainScenePath')?.trim() ??
        'res://scenes/generated/macro/Main.tscn';

      const runId = randomUUID();
      const startedAt = nowIso();

      const manifest: MacroManifest = {
        schemaVersion: 1,
        runId,
        startedAt,
        endedAt: startedAt,
        macros: [],
      };

      const collectedPlans: Array<{
        macroId: string;
        title: string;
        description: string;
        outputs: string[];
        operations: MacroOp[];
      }> = [];

      for (const id of macroIds) {
        const macro = getMacro(id);
        if (!macro) {
          return {
            ok: false,
            summary: `macro_manager: unknown macroId "${id}"`,
            details: { macroId: id, supportedMacros: getMacroList() },
          };
        }
        collectedPlans.push({
          macroId: macro.id,
          title: macro.title,
          description: macro.description,
          outputs: macro.outputs,
          operations: macro.buildOps(),
        });
      }

      if (dryRun) {
        return {
          ok: true,
          summary: 'macro_manager: dryRun (no changes applied)',
          details: {
            ...(pixel
              ? {
                  pixel: {
                    tool: 'pixel_manager',
                    args: {
                      action: 'macro_run',
                      projectPath,
                      ...pixel,
                      forceRegenerate,
                    },
                  },
                }
              : {}),
            plans: collectedPlans,
            ...(composeMainScene
              ? {
                  composeMainScene: {
                    mainScenePath,
                    worldScenePath: pixel
                      ? guessPixelWorldScenePath(pixel)
                      : 'res://scenes/generated/world/World.tscn',
                  },
                }
              : {}),
          },
        };
      }

      await ctx.ensureGodotPath();

      let worldScenePathFromPixel: string | null = null;

      if (pixel) {
        const resp = await callBaseTool(baseHandlers, 'pixel_manager', {
          action: 'macro_run',
          projectPath,
          ...pixel,
          forceRegenerate,
        });

        manifest.macros.push({
          macroId: '@pixel_manager:macro_run',
          status: resp.ok ? 'done' : 'failed',
          operationsPlanned: 1,
          operationsExecuted: 1,
          created: [],
          skippedExisting: [],
          skippedUnchanged: [],
          skippedDifferent: [],
          summary: resp.summary,
          details: resp.details,
        });

        if (!resp.ok) {
          manifest.endedAt = nowIso();
          await writeMacroManifest(projectPath, manifest);
          return {
            ok: false,
            summary: 'macro_manager: pixel_manager failed',
            details: { runId, manifest },
            logs: resp.logs,
          };
        }

        const pixelManifest = await readPixelManifest(projectPath);
        const worldOut = pixelManifest?.outputs?.world as unknown;
        if (
          worldOut &&
          typeof worldOut === 'object' &&
          !Array.isArray(worldOut)
        ) {
          const p =
            (worldOut as { scenePath?: unknown }).scenePath ??
            (worldOut as { scene_path?: unknown }).scene_path;
          if (typeof p === 'string' && p.trim().length > 0)
            worldScenePathFromPixel = p.trim();
        }

        if (!worldScenePathFromPixel) {
          manifest.endedAt = nowIso();
          await writeMacroManifest(projectPath, manifest);
          return {
            ok: false,
            summary:
              'macro_manager: pixel pipeline did not produce a world scene',
            details: {
              runId,
              manifest,
              suggestions: [
                'Ensure your pixel goal/plan includes pixel_world_generate (or pass an explicit plan).',
              ],
            },
          };
        }
      }

      for (const plan of collectedPlans) {
        const prep = await prepareMacroOps(
          projectPath,
          plan.operations,
          forceRegenerate,
        );

        let status: 'done' | 'failed' | 'skipped' = 'skipped';
        let summary: string | undefined;
        let details: unknown | undefined;

        const opsToRun: MacroOp[] = [...prep.ops];
        if (doValidate) {
          for (const p of prep.created) {
            if (p.endsWith('.tscn')) opsToRun.push(opValidateScene(p));
          }
        }

        if (opsToRun.length > 0) {
          const resp = await callBaseTool(
            baseHandlers,
            'godot_headless_batch',
            {
              projectPath,
              steps: opsToRun,
              stopOnError: true,
            },
          );
          status = resp.ok ? 'done' : 'failed';
          summary = resp.summary;
          details = resp.details;

          manifest.macros.push({
            macroId: plan.macroId,
            status,
            operationsPlanned: prep.plannedOps,
            operationsExecuted: opsToRun.length,
            created: prep.created,
            skippedExisting: prep.skippedExisting,
            skippedUnchanged: prep.skippedUnchanged,
            skippedDifferent: prep.skippedDifferent,
            summary,
            details,
          });

          if (!resp.ok) {
            manifest.endedAt = nowIso();
            await writeMacroManifest(projectPath, manifest);
            return {
              ok: false,
              summary: `macro_manager: failed (${plan.macroId})`,
              details: { runId, manifest },
              logs: resp.logs,
            };
          }
        } else {
          manifest.macros.push({
            macroId: plan.macroId,
            status,
            operationsPlanned: prep.plannedOps,
            operationsExecuted: 0,
            created: prep.created,
            skippedExisting: prep.skippedExisting,
            skippedUnchanged: prep.skippedUnchanged,
            skippedDifferent: prep.skippedDifferent,
          });
        }
      }

      if (composeMainScene) {
        const worldScenePath =
          worldScenePathFromPixel ??
          (pixel ? guessPixelWorldScenePath(pixel) : null);

        if (!worldScenePath) {
          manifest.endedAt = nowIso();
          await writeMacroManifest(projectPath, manifest);
          return {
            ok: false,
            summary:
              'macro_manager: composeMainScene requires a pixel world scene',
            details: {
              runId,
              manifest,
              suggestions: [
                'Provide pixel.goal/pixel.plan so macro_manager can generate a world scene first.',
              ],
            },
          };
        }

        const corePaths = [
          worldScenePath,
          'res://scenes/generated/macro/player/Player.tscn',
          'res://scenes/generated/macro/camera/CameraRig2D.tscn',
          'res://scripts/macro/input/InputManager.gd',
        ];

        const missing: string[] = [];
        for (const p of corePaths) {
          const abs = resolveInsideProject(projectPath, p);
          if (!existsSync(abs)) missing.push(p);
        }

        if (missing.length > 0) {
          manifest.endedAt = nowIso();
          await writeMacroManifest(projectPath, manifest);
          return {
            ok: false,
            summary:
              'macro_manager: composeMainScene failed (missing required outputs)',
            details: {
              runId,
              missing,
              suggestions: [
                'Run the required macros (player/camera/input) and ensure pixel world generation succeeded.',
              ],
            },
          };
        }

        const hasHud = existsSync(
          resolveInsideProject(
            projectPath,
            'res://scenes/generated/macro/ui/HUD.tscn',
          ),
        );
        const hasPauseMenu = existsSync(
          resolveInsideProject(
            projectPath,
            'res://scenes/generated/macro/ui/PauseMenu.tscn',
          ),
        );
        const hasSaveManager = existsSync(
          resolveInsideProject(
            projectPath,
            'res://scripts/macro/save/SaveManager.gd',
          ),
        );
        const hasAudioManager = existsSync(
          resolveInsideProject(
            projectPath,
            'res://scripts/macro/audio/AudioManager.gd',
          ),
        );
        const hasUiManager = existsSync(
          resolveInsideProject(
            projectPath,
            'res://scripts/macro/ui/UIManager.gd',
          ),
        );

        const composeOps = buildComposeMainSceneOps(
          worldScenePath,
          mainScenePath,
          {
            includeHud: hasHud,
            includePauseMenu: hasPauseMenu,
            includeSaveManager: hasSaveManager,
            includeAudioManager: hasAudioManager,
            includeUiManager: hasUiManager,
          },
        );
        if (doValidate) composeOps.push(opValidateScene(mainScenePath));

        const prep = await prepareMacroOps(
          projectPath,
          composeOps,
          forceRegenerate,
        );
        const resp =
          prep.ops.length > 0
            ? await callBaseTool(baseHandlers, 'godot_headless_batch', {
                projectPath,
                steps: prep.ops,
                stopOnError: true,
              })
            : { ok: true, summary: 'compose skipped (no ops)', details: {} };

        manifest.macros.push({
          macroId: 'compose_main_scene',
          status: resp.ok ? 'done' : 'failed',
          operationsPlanned: prep.plannedOps,
          operationsExecuted: prep.ops.length,
          created: prep.created,
          skippedExisting: prep.skippedExisting,
          skippedUnchanged: prep.skippedUnchanged,
          skippedDifferent: prep.skippedDifferent,
          summary: resp.summary,
          details: resp.details,
        });

        if (!resp.ok) {
          manifest.endedAt = nowIso();
          await writeMacroManifest(projectPath, manifest);
          return {
            ok: false,
            summary: 'macro_manager: composeMainScene failed',
            details: { runId, manifest },
            logs: (resp as ToolResponse).logs,
          };
        }
      }

      manifest.endedAt = nowIso();
      await writeMacroManifest(projectPath, manifest);

      return {
        ok: true,
        summary: 'macro_manager: run complete',
        details: {
          runId,
          manifestPath: 'res://.godot_mcp/macro_manifest.json',
          manifest,
        },
      };
    },
  };
}
