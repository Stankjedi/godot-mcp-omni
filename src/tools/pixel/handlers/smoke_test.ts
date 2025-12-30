import {
  asNonEmptyString,
  asOptionalNumber,
  asOptionalString,
} from '../../../validation.js';
import type {
  PixelManifestStep,
  PixelProjectProfile,
} from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';
import type { BaseToolHandlers } from '../../unified/shared.js';

import { nowIso } from '../manifest.js';

import { analyzePixelProjectForTool, requireToolHandler } from './shared.js';

type SmokeTestOutputs = {
  scenePath: string | null;
  headless: boolean;
  waitMs: number;
  issues: string[];
};

export async function runSmokeTest(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
): Promise<{
  response: ToolResponse;
  outputs?: SmokeTestOutputs;
  step: PixelManifestStep;
  profile: PixelProjectProfile;
}> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
  const scenePath = asOptionalString(argsObj.scenePath, 'scenePath')?.trim();
  const waitMs = Math.floor(asOptionalNumber(argsObj.waitMs, 'waitMs') ?? 1500);

  const startedAt = nowIso();
  const profile = await analyzePixelProjectForTool(ctx, projectPath);

  const runProject = requireToolHandler(baseHandlers, 'run_project');
  const getDebugOutput = requireToolHandler(baseHandlers, 'get_debug_output');
  const stopProject = requireToolHandler(baseHandlers, 'stop_project');

  const runResp = await runProject({
    projectPath,
    headless: true,
    ...(scenePath ? { scene: scenePath } : {}),
  });

  let issues: string[] = [];
  let debugResp: ToolResponse | null = null;
  let stopResp: ToolResponse | null = null;
  if (runResp.ok) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    debugResp = await getDebugOutput({});
    stopResp = await stopProject({});

    const outLines =
      debugResp.ok &&
      debugResp.details &&
      typeof debugResp.details === 'object' &&
      !Array.isArray(debugResp.details) &&
      Array.isArray((debugResp.details as Record<string, unknown>).output)
        ? ((debugResp.details as Record<string, unknown>).output as unknown[])
            .filter((v): v is string => typeof v === 'string')
            .filter((v) => v.trim().length > 0)
        : [];
    const errLines =
      debugResp.ok &&
      debugResp.details &&
      typeof debugResp.details === 'object' &&
      !Array.isArray(debugResp.details) &&
      Array.isArray((debugResp.details as Record<string, unknown>).errors)
        ? ((debugResp.details as Record<string, unknown>).errors as unknown[])
            .filter((v): v is string => typeof v === 'string')
            .filter((v) => v.trim().length > 0)
        : [];

    issues = [...outLines, ...errLines].filter((line) =>
      /error|exception|panic|failed/iu.test(line),
    );
  }

  const outputs: SmokeTestOutputs = {
    scenePath: scenePath ?? null,
    headless: true,
    waitMs,
    issues,
  };

  const response: ToolResponse = runResp.ok
    ? {
        ok: true,
        summary: 'Smoke test completed',
        details: {
          output: outputs,
          issues,
          debug: debugResp,
          stop: stopResp,
        },
      }
    : runResp;

  const step: PixelManifestStep = {
    name: 'pixel_smoke_test',
    startedAt,
    finishedAt: nowIso(),
    ok: Boolean(response.ok),
    summary: response.summary,
    details: {
      ...(response.details ?? {}),
      output: outputs,
    },
  };

  return response.ok
    ? { response, outputs, step, profile }
    : { response, step, profile };
}
