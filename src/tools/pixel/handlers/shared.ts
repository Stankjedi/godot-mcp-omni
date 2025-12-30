import { analyzePixelProject as analyzePixelProjectImpl } from '../../../pipeline/pixel_project_analyzer.js';
import type { PixelProjectProfile } from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolHandler, ToolResponse } from '../../types.js';
import type { BaseToolHandlers } from '../../unified/shared.js';

export function externalToolsAllowed(requested: boolean): boolean {
  return requested && process.env.ALLOW_EXTERNAL_TOOLS === 'true';
}

export function httpSpecGenConfigured(requested: boolean): boolean {
  if (!externalToolsAllowed(requested)) return false;
  return (process.env.SPEC_GEN_URL ?? '').trim().length > 0;
}

export function overwriteAllowed(forceRegenerate: boolean): boolean {
  if (!forceRegenerate) return true;
  return process.env.ALLOW_DANGEROUS_OPS === 'true';
}

export function forceRegenerateBlocked(toolName: string): ToolResponse {
  return {
    ok: false,
    summary: `${toolName}: forceRegenerate requires ALLOW_DANGEROUS_OPS=true`,
    details: {
      suggestions: [
        'Set ALLOW_DANGEROUS_OPS=true to allow overwriting generated outputs.',
      ],
    },
  };
}

export async function analyzePixelProjectForTool(
  ctx: ServerContext,
  projectPath: string,
): Promise<PixelProjectProfile> {
  ctx.assertValidProject(projectPath);
  return await analyzePixelProjectImpl({ projectPath, logDebug: ctx.logDebug });
}

export function requireToolHandler(
  baseHandlers: BaseToolHandlers,
  name: string,
): ToolHandler {
  const handler = baseHandlers[name];
  if (!handler) {
    throw new Error(`Internal error: missing handler for ${name}`);
  }
  return handler;
}
