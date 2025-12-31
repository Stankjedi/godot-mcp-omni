import { asOptionalPositiveNumber } from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import {
  callBaseTool,
  hasEditorConnection,
  maybeGetString,
  parseResourceSpec,
  resourcePathFromSpec,
  toResourceJson,
  type BaseToolHandlers,
} from '../shared.js';

export async function handleAttachScript(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  scriptArgs: Record<string, unknown>,
  timeoutMs: number | undefined,
): Promise<ToolResponse> {
  const localTimeout =
    asOptionalPositiveNumber(scriptArgs.timeoutMs, 'timeoutMs') ?? timeoutMs;
  const nodePath = maybeGetString(
    scriptArgs,
    ['nodePath', 'node_path'],
    'nodePath',
  );
  const scriptPath = maybeGetString(
    scriptArgs,
    ['scriptPath', 'script_path'],
    'scriptPath',
  );
  const scriptSpec = parseResourceSpec(
    (scriptArgs as Record<string, unknown>).script ?? scriptPath,
    'script',
  );
  if (!nodePath || !scriptSpec) {
    return {
      ok: false,
      summary: 'attach_script requires nodePath and script/scriptPath',
      details: { required: ['nodePath', 'scriptPath'] },
    };
  }

  if (hasEditorConnection(ctx)) {
    return await callBaseTool(baseHandlers, 'godot_editor_batch', {
      actionName: 'godot_scene_manager:attach_script',
      steps: [
        {
          method: 'set_property',
          params: {
            node_path: nodePath,
            property: 'script',
            value: toResourceJson(scriptSpec),
          },
        },
      ],
      ...(localTimeout ? { timeoutMs: localTimeout } : {}),
    });
  }

  const projectPath = maybeGetString(
    scriptArgs,
    ['projectPath', 'project_path'],
    'projectPath',
  );
  const scenePath = maybeGetString(
    scriptArgs,
    ['scenePath', 'scene_path'],
    'scenePath',
  );
  if (!projectPath || !scenePath) {
    return {
      ok: false,
      summary:
        'Not connected to editor bridge; attach_script requires projectPath and scenePath for headless mode',
      details: { required: ['projectPath', 'scenePath'] },
    };
  }

  const resolvedScriptPath = resourcePathFromSpec(scriptSpec);
  if (!resolvedScriptPath) {
    return {
      ok: false,
      summary: 'attach_script requires a script path for headless mode',
      details: { script: scriptSpec },
    };
  }

  return await callBaseTool(baseHandlers, 'godot_headless_op', {
    projectPath,
    operation: 'attach_script',
    params: { scenePath, nodePath, scriptPath: resolvedScriptPath },
  });
}
