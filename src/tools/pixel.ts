import { asRecord } from '../validation.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';
import type { BaseToolHandlers } from './unified/shared.js';

import { appendManifest } from './pixel/manifest.js';
import { runGoalToSpec } from './pixel/handlers/goal_to_spec.js';
import { runExportPreview } from './pixel/handlers/export_preview.js';
import { runLayerEnsure } from './pixel/handlers/layer_ensure.js';
import { runMacroRun } from './pixel/handlers/macro_run.js';
import { runManifestGet } from './pixel/handlers/manifest_get.js';
import { runObjectGenerate } from './pixel/handlers/object_generate.js';
import { runObjectPlace } from './pixel/handlers/object_place.js';
import { runProjectAnalyze } from './pixel/handlers/project_analyze.js';
import { runSmokeTest } from './pixel/handlers/smoke_test.js';
import { runTilemapGenerate } from './pixel/handlers/tilemap_generate.js';
import { runWorldGenerate } from './pixel/handlers/world_generate.js';

export function createPixelToolHandlers(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): Record<string, ToolHandler> {
  return {
    pixel_project_analyze: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const result = await runProjectAnalyze(ctx, argsObj);
      await appendManifest(result.profile.projectPath, {
        profile: result.profile,
        step: result.step,
        outputs: result.outputs
          ? { profile: result.outputs.profile }
          : undefined,
      });
      return result.response;
    },

    pixel_goal_to_spec: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const result = await runGoalToSpec(ctx, argsObj);
      await appendManifest(result.profile.projectPath, {
        profile: result.profile,
        step: result.step,
        outputs: result.outputs ? { goalSpec: result.outputs } : undefined,
      });
      return result.response;
    },

    pixel_tilemap_generate: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const result = await runTilemapGenerate(ctx, baseHandlers, argsObj);
      await appendManifest(result.profile.projectPath, {
        profile: result.profile,
        step: result.step,
        outputs: result.outputs ? { tileset: result.outputs } : undefined,
      });
      return result.response;
    },

    pixel_world_generate: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const result = await runWorldGenerate(ctx, baseHandlers, argsObj);
      await appendManifest(result.profile.projectPath, {
        profile: result.profile,
        seed: result.outputs?.seed,
        step: result.step,
        outputs: result.outputs ? { world: result.outputs } : undefined,
      });
      return result.response;
    },

    pixel_layer_ensure: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const result = await runLayerEnsure(ctx, baseHandlers, argsObj);
      await appendManifest(result.profile.projectPath, {
        profile: result.profile,
        step: result.step,
        outputs: result.outputs ? { layers: result.outputs } : undefined,
      });
      return result.response;
    },

    pixel_object_generate: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const result = await runObjectGenerate(ctx, baseHandlers, argsObj);
      await appendManifest(result.profile.projectPath, {
        profile: result.profile,
        step: result.step,
        outputs: result.outputs ? { objects: result.outputs } : undefined,
      });
      return result.response;
    },

    pixel_object_place: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const result = await runObjectPlace(ctx, baseHandlers, argsObj);
      await appendManifest(result.profile.projectPath, {
        profile: result.profile,
        seed: result.outputs?.seed,
        step: result.step,
        outputs: result.outputs ? { placement: result.outputs } : undefined,
      });
      return result.response;
    },

    pixel_smoke_test: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const result = await runSmokeTest(ctx, baseHandlers, argsObj);
      await appendManifest(result.profile.projectPath, {
        profile: result.profile,
        step: result.step,
        outputs: result.outputs ? { smokeTest: result.outputs } : undefined,
      });
      return result.response;
    },

    pixel_export_preview: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const result = await runExportPreview(ctx, baseHandlers, argsObj);
      await appendManifest(result.profile.projectPath, {
        profile: result.profile,
        step: result.step,
        outputs: result.outputs ? { preview: result.outputs } : undefined,
      });
      return result.response;
    },

    pixel_macro_run: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      return await runMacroRun(ctx, baseHandlers, argsObj);
    },

    pixel_manifest_get: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      return await runManifestGet(argsObj);
    },
  };
}
