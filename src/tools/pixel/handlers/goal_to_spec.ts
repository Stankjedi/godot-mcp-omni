import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNumber,
} from '../../../validation.js';
import type {
  PixelManifestStep,
  PixelProjectProfile,
} from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import { nowIso } from '../manifest.js';
import {
  deriveSpecsFromPlan,
  generatePlanFromGoalViaHttp,
  normalizeMacroPlanFromGoal,
  type GoalToSpecOutputs,
} from '../macro.js';

import { analyzePixelProjectForTool, httpSpecGenConfigured } from './shared.js';

export async function runGoalToSpec(
  ctx: ServerContext,
  argsObj: Record<string, unknown>,
): Promise<{
  response: ToolResponse;
  outputs?: Record<string, unknown>;
  step: PixelManifestStep;
  profile: PixelProjectProfile;
}> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
  const goal = asNonEmptyString(argsObj.goal, 'goal').trim();
  const allowExternalTools =
    asOptionalBoolean(argsObj.allowExternalTools, 'allowExternalTools') ??
    false;
  const timeoutMs = Math.floor(
    asOptionalNumber(argsObj.timeoutMs, 'timeoutMs') ?? 30_000,
  );

  const startedAt = nowIso();
  const profile = await analyzePixelProjectForTool(ctx, projectPath);

  let out: GoalToSpecOutputs;
  try {
    if (httpSpecGenConfigured(allowExternalTools)) {
      out = await generatePlanFromGoalViaHttp(goal, profile, timeoutMs);
    } else {
      const plan = normalizeMacroPlanFromGoal(goal);
      out = {
        adapter: 'builtin',
        plan,
        derived: deriveSpecsFromPlan(plan),
      };
    }
  } catch (error) {
    const response: ToolResponse = {
      ok: false,
      summary: `Spec generation failed: ${error instanceof Error ? error.message : String(error)}`,
      details: {
        goal,
        adapter: httpSpecGenConfigured(allowExternalTools) ? 'http' : 'builtin',
        suggestions: httpSpecGenConfigured(allowExternalTools)
          ? [
              'Verify SPEC_GEN_URL is reachable and returns a JSON object.',
              'Check SPEC_GEN_AUTH_HEADER / SPEC_GEN_AUTH_VALUE if auth is required.',
              'Set allowExternalTools=false to use the builtin heuristic parser.',
            ]
          : [
              'Ensure the goal text includes enough details (size, biome, density) or provide an explicit plan.',
            ],
      },
    };
    const step: PixelManifestStep = {
      name: 'pixel_goal_to_spec',
      startedAt,
      finishedAt: nowIso(),
      ok: false,
      summary: response.summary,
      details: response.details as Record<string, unknown>,
    };
    return { response, step, profile };
  }

  const response: ToolResponse = {
    ok: true,
    summary: 'Goal converted to pixel specs',
    details: {
      adapter: out.adapter,
      goal,
      plan: out.plan,
      derived: out.derived,
    },
  };
  const step: PixelManifestStep = {
    name: 'pixel_goal_to_spec',
    startedAt,
    finishedAt: nowIso(),
    ok: true,
    summary: response.summary,
    details: response.details as Record<string, unknown>,
  };

  return {
    response,
    outputs: (response.details ?? {}) as Record<string, unknown>,
    step,
    profile,
  };
}
