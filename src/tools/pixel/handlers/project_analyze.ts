import { asNonEmptyString } from '../../../validation.js';
import type {
  PixelManifestStep,
  PixelProjectProfile,
} from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import { nowIso } from '../manifest.js';

import { analyzePixelProjectForTool } from './shared.js';

type ProjectAnalyzeOutputs = {
  profile: PixelProjectProfile;
};

export async function runProjectAnalyze(
  ctx: ServerContext,
  argsObj: Record<string, unknown>,
): Promise<{
  response: ToolResponse;
  outputs?: ProjectAnalyzeOutputs;
  step: PixelManifestStep;
  profile: PixelProjectProfile;
}> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');

  const startedAt = nowIso();
  const profile = await analyzePixelProjectForTool(ctx, projectPath);
  const finishedAt = nowIso();

  const response: ToolResponse = {
    ok: true,
    summary: 'Pixel project profile generated',
    details: { profile },
  };
  const step: PixelManifestStep = {
    name: 'pixel_project_analyze',
    startedAt,
    finishedAt,
    ok: true,
    summary: response.summary,
    details: response.details as Record<string, unknown>,
  };

  return { response, outputs: { profile }, step, profile };
}
