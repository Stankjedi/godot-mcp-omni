import type { ToolDefinition } from './tool_definition.js';

import { ASEPRITE_TOOL_DEFINITIONS } from './aseprite_tools.js';
import { EDITOR_RPC_TOOL_DEFINITIONS } from './editor_rpc_tools.js';
import { HEADLESS_TOOL_DEFINITIONS } from './headless_tools.js';
import { MACRO_TOOL_DEFINITIONS } from './macro_tools.js';
import { PIXEL_MANAGER_TOOL_DEFINITIONS } from './pixel_manager_tools.js';
import { PIXEL_TOOL_DEFINITIONS } from './pixel_tools.js';
import { PROJECT_TOOL_DEFINITIONS } from './project_tools.js';
import { SERVER_TOOL_DEFINITIONS } from './server_tools.js';
import { UNIFIED_TOOL_DEFINITIONS } from './unified_tools.js';
import { WORKFLOW_TOOL_DEFINITIONS } from './workflow_tools.js';

export const TOOL_DEFINITION_GROUPS: Record<string, ToolDefinition[]> = {
  headless: HEADLESS_TOOL_DEFINITIONS,
  editor_rpc: EDITOR_RPC_TOOL_DEFINITIONS,
  project: PROJECT_TOOL_DEFINITIONS,
  unified: UNIFIED_TOOL_DEFINITIONS,
  server: SERVER_TOOL_DEFINITIONS,
  aseprite: ASEPRITE_TOOL_DEFINITIONS,
  pixel_manager: PIXEL_MANAGER_TOOL_DEFINITIONS,
  macro: MACRO_TOOL_DEFINITIONS,
  pixel: PIXEL_TOOL_DEFINITIONS,
  workflow: WORKFLOW_TOOL_DEFINITIONS,
};

export const ALL_TOOL_DEFINITIONS: ToolDefinition[] = [
  ...HEADLESS_TOOL_DEFINITIONS,
  ...EDITOR_RPC_TOOL_DEFINITIONS,
  ...PROJECT_TOOL_DEFINITIONS,
  ...UNIFIED_TOOL_DEFINITIONS,
  ...SERVER_TOOL_DEFINITIONS,
  ...ASEPRITE_TOOL_DEFINITIONS,
  ...PIXEL_MANAGER_TOOL_DEFINITIONS,
  ...MACRO_TOOL_DEFINITIONS,
  ...PIXEL_TOOL_DEFINITIONS,
  ...WORKFLOW_TOOL_DEFINITIONS,
];
