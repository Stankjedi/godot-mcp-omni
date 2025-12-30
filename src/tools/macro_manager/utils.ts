import type { ToolResponse } from '../types.js';

export function nowIso(): string {
  return new Date().toISOString();
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
        'Set ALLOW_DANGEROUS_OPS=true to allow overwriting existing outputs.',
      ],
    },
  };
}
