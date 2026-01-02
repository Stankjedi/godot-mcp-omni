import process from 'node:process';

import { MCP_SERVER_INFO } from '../server_info.js';
import { asRecord } from '../validation.js';

import {
  ALL_TOOL_DEFINITIONS,
  TOOL_DEFINITION_GROUPS,
} from './definitions/all_tools.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';

export function createServerInfoToolHandlers(
  ctx: ServerContext,
): Record<string, ToolHandler> {
  return {
    server_info: async (args: unknown): Promise<ToolResponse> => {
      asRecord(args, 'args');

      const allowDangerousOps = process.env.ALLOW_DANGEROUS_OPS === 'true';
      const allowExternalTools = process.env.ALLOW_EXTERNAL_TOOLS === 'true';
      const godotPath = process.env.GODOT_PATH ?? '';

      const groups: Record<string, number> = {};
      let toolCount = 0;
      for (const [groupName, defs] of Object.entries(TOOL_DEFINITION_GROUPS)) {
        groups[groupName] = defs.length;
        toolCount += defs.length;
      }

      return {
        ok: true,
        summary: `${MCP_SERVER_INFO.name} ${MCP_SERVER_INFO.version}`,
        details: {
          server: {
            name: MCP_SERVER_INFO.name,
            version: MCP_SERVER_INFO.version,
          },
          runtime: {
            pid: process.pid,
            platform: process.platform,
            node: process.version,
          },
          safety: {
            allowDangerousOps,
            allowExternalTools,
          },
          godot: {
            configured: godotPath.trim().length > 0,
          },
          editorBridge: {
            connected: Boolean(ctx.getEditorClient()),
          },
          tools: {
            count: toolCount,
            groups,
            names: ALL_TOOL_DEFINITIONS.map((t) => t.name).sort((a, b) =>
              a.localeCompare(b),
            ),
          },
        },
        logs: [],
      };
    },
  };
}
