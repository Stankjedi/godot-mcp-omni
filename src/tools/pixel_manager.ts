import {
  asNonEmptyString,
  asRecord,
  ValidationError,
  valueType,
} from '../validation.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';
import type { BaseToolHandlers } from './unified/shared.js';
import { normalizeAction, supportedActionError } from './unified/shared.js';

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

const SUPPORTED_ACTIONS = [
  'project_analyze',
  'goal_to_spec',
  'tilemap_generate',
  'world_generate',
  'layer_ensure',
  'object_generate',
  'object_place',
  'export_preview',
  'smoke_test',
  'macro_run',
  'manifest_get',
];

export function createPixelManagerToolHandlers(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): Record<string, ToolHandler> {
  return {
    pixel_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);

      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw);

      try {
        if (action === 'project_analyze') {
          const result = await runProjectAnalyze(ctx, argsObj);
          await appendManifest(result.profile.projectPath, {
            profile: result.profile,
            step: result.step,
            outputs: result.outputs
              ? { profile: result.outputs.profile }
              : undefined,
          });
          return result.response;
        }

        if (action === 'goal_to_spec') {
          const result = await runGoalToSpec(ctx, argsObj);
          await appendManifest(result.profile.projectPath, {
            profile: result.profile,
            step: result.step,
            outputs: result.outputs ? { goalSpec: result.outputs } : undefined,
          });
          return result.response;
        }

        if (action === 'tilemap_generate') {
          const result = await runTilemapGenerate(ctx, baseHandlers, argsObj);
          await appendManifest(result.profile.projectPath, {
            profile: result.profile,
            step: result.step,
            outputs: result.outputs ? { tileset: result.outputs } : undefined,
          });
          return result.response;
        }

        if (action === 'world_generate') {
          const result = await runWorldGenerate(ctx, baseHandlers, argsObj);
          await appendManifest(result.profile.projectPath, {
            profile: result.profile,
            seed: result.outputs?.seed,
            step: result.step,
            outputs: result.outputs ? { world: result.outputs } : undefined,
          });
          return result.response;
        }

        if (action === 'layer_ensure') {
          const result = await runLayerEnsure(ctx, baseHandlers, argsObj);
          await appendManifest(result.profile.projectPath, {
            profile: result.profile,
            step: result.step,
            outputs: result.outputs ? { layers: result.outputs } : undefined,
          });
          return result.response;
        }

        if (action === 'object_generate') {
          const result = await runObjectGenerate(ctx, baseHandlers, argsObj);
          await appendManifest(result.profile.projectPath, {
            profile: result.profile,
            step: result.step,
            outputs: result.outputs ? { objects: result.outputs } : undefined,
          });
          return result.response;
        }

        if (action === 'object_place') {
          const result = await runObjectPlace(ctx, baseHandlers, argsObj);
          await appendManifest(result.profile.projectPath, {
            profile: result.profile,
            seed: result.outputs?.seed,
            step: result.step,
            outputs: result.outputs ? { placement: result.outputs } : undefined,
          });
          return result.response;
        }

        if (action === 'smoke_test') {
          const result = await runSmokeTest(ctx, baseHandlers, argsObj);
          await appendManifest(result.profile.projectPath, {
            profile: result.profile,
            step: result.step,
            outputs: result.outputs ? { smokeTest: result.outputs } : undefined,
          });
          return result.response;
        }

        if (action === 'export_preview') {
          const result = await runExportPreview(ctx, baseHandlers, argsObj);
          await appendManifest(result.profile.projectPath, {
            profile: result.profile,
            step: result.step,
            outputs: result.outputs ? { preview: result.outputs } : undefined,
          });
          return result.response;
        }

        if (action === 'macro_run') {
          return await runMacroRun(ctx, baseHandlers, argsObj);
        }

        if (action === 'manifest_get') {
          return await runManifestGet(argsObj);
        }

        return supportedActionError(
          'pixel_manager',
          actionRaw,
          SUPPORTED_ACTIONS,
        );
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        return {
          ok: false,
          summary: `pixel_manager: failed to run ${action}`,
          details: {
            action,
            error: error instanceof Error ? error.message : String(error),
            receivedType: valueType(args),
          },
        };
      }
    },
  };
}
