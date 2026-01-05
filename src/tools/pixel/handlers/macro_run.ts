import { resolveInsideProject } from '../../../security.js';
import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNumber,
  asOptionalRecord,
  asOptionalString,
} from '../../../validation.js';

import {
  PIXEL_MANIFEST_RES_PATH,
  readPixelManifest,
  writePixelManifest,
} from '../../../pipeline/pixel_manifest.js';
import type {
  PixelManifest,
  PixelManifestStep,
  PixelProjectProfile,
} from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';
import type { BaseToolHandlers } from '../../unified/shared.js';

import { fileExists } from '../files.js';
import { nowIso } from '../manifest.js';
import { normalizeResPath, tilesetPathFromName } from '../paths.js';
import { parseMapSize } from '../spec.js';
import {
  deriveSpecsFromPlan,
  generatePlanFromGoalViaHttp,
  normalizeMacroPlanFromGoal,
  parseMacroPlanInput,
  sha1,
  stableJsonStringify,
  type GoalToSpecOutputs,
  type MacroStep,
} from '../macro.js';

import { runExportPreview } from './export_preview.js';
import { runLayerEnsure } from './layer_ensure.js';
import { runObjectGenerate } from './object_generate.js';
import { runObjectPlace } from './object_place.js';
import { runSmokeTest } from './smoke_test.js';
import { runTilemapGenerate } from './tilemap_generate.js';
import { runWorldGenerate } from './world_generate.js';
import { analyzePixelProjectForTool, httpSpecGenConfigured } from './shared.js';

export async function runMacroRun(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
): Promise<ToolResponse> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
  const goal = asOptionalString(argsObj.goal, 'goal')?.trim();
  const dryRun = asOptionalBoolean(argsObj.dryRun, 'dryRun') ?? false;
  const failFast = asOptionalBoolean(argsObj.failFast, 'failFast') ?? true;
  const seed = Math.floor(asOptionalNumber(argsObj.seed, 'seed') ?? 12345);
  const forceRegenerate =
    asOptionalBoolean(argsObj.forceRegenerate, 'forceRegenerate') ?? false;
  const allowExternalTools =
    asOptionalBoolean(argsObj.allowExternalTools, 'allowExternalTools') ??
    false;
  const smokeTestRequested =
    asOptionalBoolean(argsObj.smokeTest, 'smokeTest') ?? false;
  const exportPreviewRequested =
    asOptionalBoolean(argsObj.exportPreview, 'exportPreview') ??
    asOptionalBoolean(argsObj.preview, 'preview') ??
    false;
  const smokeWaitMs = Math.floor(
    asOptionalNumber(argsObj.smokeWaitMs, 'smokeWaitMs') ?? 1500,
  );
  const previewOutputPngPath = asOptionalString(
    argsObj.previewOutputPngPath,
    'previewOutputPngPath',
  )?.trim();
  const specGenTimeoutMs = Math.floor(
    asOptionalNumber(argsObj.specGenTimeoutMs, 'specGenTimeoutMs') ?? 30_000,
  );

  const specGenStartedAt = nowIso();
  let plan: MacroStep[] = [];
  const hasExplicitPlan = Array.isArray(argsObj.plan);
  let specGen: GoalToSpecOutputs | null = null;
  let profileForPlan: PixelProjectProfile | null = null;

  try {
    if (hasExplicitPlan) {
      plan = parseMacroPlanInput(argsObj.plan, 'plan');
      specGen = {
        adapter: 'explicit_plan',
        plan,
        derived: deriveSpecsFromPlan(plan),
      };
    } else if (goal) {
      if (httpSpecGenConfigured(allowExternalTools)) {
        profileForPlan = await analyzePixelProjectForTool(ctx, projectPath);
        specGen = await generatePlanFromGoalViaHttp(
          goal,
          profileForPlan,
          specGenTimeoutMs,
        );
        plan = specGen.plan;
      } else {
        plan = normalizeMacroPlanFromGoal(goal);
        specGen = {
          adapter: 'builtin',
          plan,
          derived: deriveSpecsFromPlan(plan),
        };
      }
    } else {
      plan = normalizeMacroPlanFromGoal('');
      specGen = {
        adapter: 'builtin',
        plan,
        derived: deriveSpecsFromPlan(plan),
      };
    }
  } catch (error) {
    const summary = `Spec generation failed: ${error instanceof Error ? error.message : String(error)}`;
    const attemptedAdapter: GoalToSpecOutputs['adapter'] = hasExplicitPlan
      ? 'explicit_plan'
      : httpSpecGenConfigured(allowExternalTools)
        ? 'http'
        : 'builtin';

    const response: ToolResponse = {
      ok: false,
      summary,
      details: {
        goal: goal ?? null,
        adapter: attemptedAdapter,
        allowExternalTools,
        specGenTimeoutMs,
        suggestions:
          attemptedAdapter === 'http'
            ? [
                'Verify SPEC_GEN_URL is reachable and returns a JSON object.',
                'Check SPEC_GEN_AUTH_HEADER / SPEC_GEN_AUTH_VALUE if auth is required.',
                'Set allowExternalTools=false to use the builtin heuristic parser.',
              ]
            : [
                'Provide a valid plan[] (with supported tools), or include more details in the goal text.',
              ],
      },
    };

    if (dryRun) return response;

    const profile =
      profileForPlan ?? (await analyzePixelProjectForTool(ctx, projectPath));
    const previousManifest = await readPixelManifest(projectPath);
    const previousOutputs =
      previousManifest && typeof previousManifest.outputs === 'object'
        ? previousManifest.outputs
        : {};
    const steps: PixelManifestStep[] = [
      {
        name: 'macro:goal_to_spec',
        startedAt: specGenStartedAt,
        finishedAt: nowIso(),
        ok: false,
        summary,
        details: response.details as Record<string, unknown>,
      },
    ];
    const outputs: Record<string, unknown> = { ...(previousOutputs ?? {}) };
    outputs.macro = {
      seed,
      goal: goal ?? null,
      plan: [],
      dag: [],
      specGen: { adapter: attemptedAdapter, derived: null },
    };

    const manifest: PixelManifest = {
      schemaVersion: 1,
      generatedAt: nowIso(),
      projectPath,
      seed,
      profile,
      steps,
      outputs,
    };
    await writePixelManifest(projectPath, manifest);

    return response;
  }

  const goalLower = (goal ?? '').toLowerCase();
  const smokeFromGoal =
    goalLower.includes('스모크') ||
    goalLower.includes('smoke') ||
    goalLower.includes('검증') ||
    goalLower.includes('test');
  const previewFromGoal =
    goalLower.includes('미리보기') ||
    goalLower.includes('프리뷰') ||
    goalLower.includes('preview') ||
    goalLower.includes('screenshot');

  const stepAction = (step: MacroStep): string => {
    const raw = asOptionalString(
      step.args.action,
      'plan[].args.action',
    )?.trim();
    return raw ? raw.toLowerCase() : '';
  };

  const shouldSmokeTest =
    smokeTestRequested || (!hasExplicitPlan && smokeFromGoal);
  const shouldExportPreview =
    exportPreviewRequested || (!hasExplicitPlan && previewFromGoal);

  const inferWorldScenePath = (): string | null => {
    for (let i = plan.length - 1; i >= 0; i -= 1) {
      const step = plan[i];
      if (!step) continue;
      const action = stepAction(step);
      if (action !== 'world_generate' && action !== 'layer_ensure') continue;

      const spec = asOptionalRecord(step.args.spec, 'macro.spec') ?? {};
      const scenePathRaw =
        asOptionalString(
          (spec as Record<string, unknown>).scenePath ??
            (spec as Record<string, unknown>).scene_path,
          'spec.scenePath',
        )?.trim() ?? '';
      if (!scenePathRaw) continue;
      return normalizeResPath(scenePathRaw);
    }
    return null;
  };

  const inferredWorldScenePath = plan.some((s) => {
    const action = stepAction(s);
    return action === 'world_generate' || action === 'layer_ensure';
  })
    ? (inferWorldScenePath() ?? 'res://scenes/generated/world/World.tscn')
    : null;

  if (
    shouldExportPreview &&
    !plan.some((s) => stepAction(s) === 'export_preview')
  ) {
    const spec: Record<string, unknown> = {};
    if (inferredWorldScenePath) spec.scenePath = inferredWorldScenePath;
    if (previewOutputPngPath) spec.outputPngPath = previewOutputPngPath;

    plan.push({
      tool: 'pixel_manager',
      args: {
        action: 'export_preview',
        ...(Object.keys(spec).length > 0 ? { spec } : {}),
      },
    });
  }

  if (shouldSmokeTest && !plan.some((s) => stepAction(s) === 'smoke_test')) {
    plan.push({
      tool: 'pixel_manager',
      args: {
        action: 'smoke_test',
        waitMs: smokeWaitMs,
        ...(inferredWorldScenePath
          ? { scenePath: inferredWorldScenePath }
          : {}),
      },
    });
  }

  type MacroNode = {
    id: string;
    tool: 'pixel_manager';
    action: string;
    stepName: string;
    args: Record<string, unknown>;
    dependsOn: string[];
    cacheKey: string;
  };

  const toEffectiveArgs = (step: MacroStep): Record<string, unknown> => {
    const action = stepAction(step);
    if (action === 'tilemap_generate') {
      return {
        projectPath,
        ...step.args,
        forceRegenerate,
        allowExternalTools,
      };
    }
    if (action === 'world_generate') {
      const spec = asOptionalRecord(step.args.spec, 'macro.spec') ?? {};
      return {
        projectPath,
        ...step.args,
        spec: { ...spec, seed },
      };
    }
    if (action === 'layer_ensure') {
      return { projectPath, ...step.args };
    }
    if (action === 'object_generate') {
      return {
        projectPath,
        ...step.args,
        forceRegenerate,
        allowExternalTools,
      };
    }
    if (action === 'object_place') {
      return { projectPath, ...step.args, seed };
    }
    if (action === 'smoke_test') {
      return { projectPath, ...step.args };
    }
    if (action === 'export_preview') {
      return { projectPath, ...step.args };
    }
    return { projectPath, ...step.args };
  };

  const nodes: MacroNode[] = plan.map((step, i) => {
    const action = stepAction(step);
    if (!action) {
      throw new Error(
        `Invalid macro plan step: missing args.action (index=${i})`,
      );
    }
    const effectiveArgs = toEffectiveArgs(step);
    const argsForCache: Record<string, unknown> = { ...effectiveArgs };
    delete argsForCache.action;

    const stepName = `pixel_${action}`;
    const cacheKey = sha1(
      stableJsonStringify({ tool: stepName, args: argsForCache }),
    );
    return {
      id: `step${i + 1}`,
      tool: 'pixel_manager',
      action,
      stepName,
      args: effectiveArgs,
      dependsOn: [],
      cacheKey,
    };
  });

  // Build a simple dependency graph (DAG) for deterministic orchestration.
  let lastTileset: string | null = null;
  let lastWorld: string | null = null;
  let lastObjects: string | null = null;
  let lastPlacement: string | null = null;
  for (const node of nodes) {
    const deps: string[] = [];
    if (node.action === 'tilemap_generate') {
      // no deps
    } else if (node.action === 'layer_ensure') {
      if (lastTileset) deps.push(lastTileset);
    } else if (node.action === 'world_generate') {
      if (lastTileset) deps.push(lastTileset);
    } else if (node.action === 'object_place') {
      if (lastWorld) deps.push(lastWorld);
      if (lastObjects) deps.push(lastObjects);
    } else if (
      node.action === 'smoke_test' ||
      node.action === 'export_preview'
    ) {
      if (lastPlacement) deps.push(lastPlacement);
      else if (lastWorld) deps.push(lastWorld);
    }
    node.dependsOn = Array.from(new Set(deps));

    if (node.action === 'tilemap_generate') lastTileset = node.id;
    if (node.action === 'layer_ensure' || node.action === 'world_generate')
      lastWorld = node.id;
    if (node.action === 'object_generate') lastObjects = node.id;
    if (node.action === 'object_place') lastPlacement = node.id;
  }

  const topoSort = (input: MacroNode[]): MacroNode[] => {
    const byId = new Map(input.map((n) => [n.id, n] as const));
    const indeg = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const n of input) {
      indeg.set(n.id, n.dependsOn.length);
      for (const dep of n.dependsOn) {
        const list = dependents.get(dep) ?? [];
        list.push(n.id);
        dependents.set(dep, list);
      }
    }

    const ready = input
      .filter((n) => (indeg.get(n.id) ?? 0) === 0)
      .map((n) => n.id);
    const out: MacroNode[] = [];
    while (ready.length > 0) {
      const id = ready.shift();
      if (!id) break;
      const node = byId.get(id);
      if (!node) continue;
      out.push(node);
      const kids = dependents.get(id) ?? [];
      for (const kid of kids) {
        const next = (indeg.get(kid) ?? 0) - 1;
        indeg.set(kid, next);
        if (next === 0) ready.push(kid);
      }
    }
    if (out.length !== input.length) {
      throw new Error('Macro plan contains cyclic dependencies');
    }
    return out;
  };

  const ordered = topoSort(nodes);

  if (dryRun) {
    return {
      ok: true,
      summary: 'Dry-run macro plan',
      details: {
        projectPath,
        seed,
        goal: goal ?? null,
        specGen: specGen
          ? { adapter: specGen.adapter, derived: specGen.derived }
          : null,
        plan,
        dag: ordered,
      },
    };
  }

  const profile =
    profileForPlan ?? (await analyzePixelProjectForTool(ctx, projectPath));
  const previousManifest = await readPixelManifest(projectPath);
  const previousOutputs =
    previousManifest && typeof previousManifest.outputs === 'object'
      ? previousManifest.outputs
      : {};
  const steps: PixelManifestStep[] = [];
  const outputs: Record<string, unknown> = { ...(previousOutputs ?? {}) };

  steps.push({
    name: 'macro:goal_to_spec',
    startedAt: specGenStartedAt,
    finishedAt: nowIso(),
    ok: true,
    summary: hasExplicitPlan
      ? 'Macro plan parsed'
      : goal
        ? 'Goal converted to macro plan'
        : 'Default macro plan selected',
    details: {
      goal: goal ?? null,
      adapter: specGen?.adapter ?? null,
      allowExternalTools,
      specGenTimeoutMs,
      derived: specGen?.derived ?? null,
      plan,
    },
  });

  const previousCacheOk = new Set<string>();
  if (previousManifest?.steps) {
    for (const s of previousManifest.steps) {
      const ck =
        s.details && typeof s.details === 'object' && !Array.isArray(s.details)
          ? (s.details as Record<string, unknown>).cacheKey
          : undefined;
      if (s.ok && typeof ck === 'string') previousCacheOk.add(ck);
    }
  }

  const canSkipWorld = async (
    args: Record<string, unknown>,
  ): Promise<boolean> => {
    if (!previousManifest || !previousManifest.outputs) return false;
    const outWorld = (previousManifest.outputs as Record<string, unknown>)
      .world;
    if (!outWorld || typeof outWorld !== 'object' || Array.isArray(outWorld))
      return false;
    const spec = asOptionalRecord(args.spec, 'spec') ?? {};
    const desiredScene = normalizeResPath(
      asOptionalString(
        spec.scenePath ?? (spec as Record<string, unknown>).scene_path,
        'spec.scenePath',
      )?.trim() ?? 'res://scenes/generated/world/World.tscn',
    );
    let desiredTileset =
      asOptionalString(
        spec.tilesetPath ?? (spec as Record<string, unknown>).tileset_path,
        'spec.tilesetPath',
      )?.trim() ?? '';
    const desiredTilesetName =
      asOptionalString(
        spec.tilesetName ?? (spec as Record<string, unknown>).tileset_name,
        'spec.tilesetName',
      )?.trim() ?? '';
    if (!desiredTileset && desiredTilesetName)
      desiredTileset = tilesetPathFromName(desiredTilesetName);
    desiredTileset = desiredTileset ? normalizeResPath(desiredTileset) : '';
    const desiredMapSize = parseMapSize(
      spec.mapSize ?? (spec as Record<string, unknown>).map_size,
      'spec.mapSize',
      { width: 256, height: 256 },
    );
    const desiredSeed = Math.floor(
      asOptionalNumber(spec.seed, 'spec.seed') ?? seed,
    );

    const prev = outWorld as Record<string, unknown>;
    const prevScene =
      typeof prev.scenePath === 'string'
        ? normalizeResPath(prev.scenePath)
        : null;
    const prevTileset =
      typeof prev.tilesetPath === 'string'
        ? normalizeResPath(prev.tilesetPath)
        : null;
    const prevMapSize =
      prev.mapSize &&
      typeof prev.mapSize === 'object' &&
      !Array.isArray(prev.mapSize)
        ? (prev.mapSize as { width?: number; height?: number })
        : null;
    const prevSeed =
      typeof prev.seed === 'number' ? Math.floor(prev.seed) : null;

    if (!prevScene || !prevTileset || !prevMapSize) return false;
    if (prevScene !== desiredScene) return false;
    if (desiredTileset && prevTileset !== desiredTileset) return false;
    if ((prevMapSize.width ?? 0) !== desiredMapSize.width) return false;
    if ((prevMapSize.height ?? 0) !== desiredMapSize.height) return false;
    if (prevSeed !== desiredSeed) return false;

    const absScene = resolveInsideProject(projectPath, prevScene);
    return await fileExists(absScene);
  };

  for (const node of ordered) {
    const startedAt = nowIso();
    let res: ToolResponse;
    let skipped = false;
    try {
      if (!forceRegenerate && previousCacheOk.has(node.cacheKey)) {
        skipped = true;
        res = {
          ok: true,
          summary: 'Skipped (cache hit)',
          details: { cacheKey: node.cacheKey, skipped: true },
        };
      } else if (!forceRegenerate && node.action === 'world_generate') {
        const skip = await canSkipWorld(node.args);
        if (skip) {
          skipped = true;
          res = {
            ok: true,
            summary: 'Skipped (existing world matches requested spec)',
            details: { cacheKey: node.cacheKey, skipped: true },
          };
        } else {
          const r = await runWorldGenerate(ctx, baseHandlers, node.args);
          res = r.response;
          if (r.outputs) outputs.world = r.outputs;
        }
      } else if (node.action === 'tilemap_generate') {
        const r = await runTilemapGenerate(ctx, baseHandlers, node.args);
        res = r.response;
        if (r.outputs) outputs.tileset = r.outputs;
      } else if (node.action === 'layer_ensure') {
        const r = await runLayerEnsure(ctx, baseHandlers, node.args);
        res = r.response;
        if (r.outputs) outputs.layers = r.outputs;
      } else if (node.action === 'object_generate') {
        const r = await runObjectGenerate(ctx, baseHandlers, node.args);
        res = r.response;
        if (r.outputs) outputs.objects = r.outputs;
      } else if (node.action === 'object_place') {
        const r = await runObjectPlace(ctx, baseHandlers, node.args);
        res = r.response;
        if (r.outputs) outputs.placement = r.outputs;
      } else if (node.action === 'smoke_test') {
        const r = await runSmokeTest(ctx, baseHandlers, node.args);
        res = r.response;
        if (r.outputs) outputs.smokeTest = r.outputs;
      } else if (node.action === 'export_preview') {
        const r = await runExportPreview(ctx, baseHandlers, node.args);
        res = r.response;
        if (r.outputs) outputs.preview = r.outputs;
      } else {
        res = {
          ok: false,
          summary: `Unsupported macro step action: ${node.action}`,
          details: {
            supportedActions: [
              'tilemap_generate',
              'layer_ensure',
              'world_generate',
              'object_generate',
              'object_place',
              'smoke_test',
              'export_preview',
            ],
          },
        };
      }
    } catch (error) {
      res = {
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
        details: { tool: node.tool, action: node.action, step: node.stepName },
      };
    }

    steps.push({
      name: node.stepName,
      startedAt,
      finishedAt: nowIso(),
      ok: Boolean(res.ok),
      summary: res.summary,
      details: {
        ...(res.details ?? {}),
        step: node.stepName,
        id: node.id,
        dependsOn: node.dependsOn,
        cacheKey: node.cacheKey,
        skipped,
      },
    });

    if (!res.ok && failFast) break;
  }

  outputs.macro = {
    seed,
    goal: goal ?? null,
    specGen: specGen
      ? { adapter: specGen.adapter, derived: specGen.derived }
      : null,
    plan,
    dag: ordered.map((n) => ({
      id: n.id,
      tool: n.tool,
      action: n.action,
      step: n.stepName,
      dependsOn: n.dependsOn,
      cacheKey: n.cacheKey,
    })),
  };

  const manifest: PixelManifest = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    projectPath,
    seed,
    profile,
    steps,
    outputs,
  };
  await writePixelManifest(projectPath, manifest);

  const overallOk = steps.every((s) => s.ok);
  return {
    ok: overallOk,
    summary: overallOk ? 'Pixel macro completed' : 'Pixel macro failed',
    details: {
      manifestPath: PIXEL_MANIFEST_RES_PATH,
      seed,
      outputs,
      steps,
    },
  };
}
