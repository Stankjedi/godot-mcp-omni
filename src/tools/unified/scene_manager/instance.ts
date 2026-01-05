import {
  asOptionalBoolean,
  asOptionalPositiveNumber,
  asOptionalRecord,
} from '../../../validation.js';

import { assertEditorRpcAllowed } from '../../../security.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import {
  callBaseTool,
  hasEditorConnection,
  maybeGetString,
  type BaseToolHandlers,
} from '../shared.js';

export async function handleInstance(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  instanceArgs: Record<string, unknown>,
  timeoutMs: number | undefined,
): Promise<ToolResponse> {
  const localTimeout =
    asOptionalPositiveNumber(instanceArgs.timeoutMs, 'timeoutMs') ?? timeoutMs;
  const ensureUniqueName = asOptionalBoolean(
    (instanceArgs as Record<string, unknown>).ensureUniqueName ??
      (instanceArgs as Record<string, unknown>).ensure_unique_name,
    'ensureUniqueName',
  );
  const sourceScenePath = maybeGetString(
    instanceArgs,
    ['scenePath', 'scene_path'],
    'scenePath',
  );
  if (hasEditorConnection(ctx)) {
    if (!sourceScenePath) {
      return {
        ok: false,
        summary: 'instance requires scenePath',
        details: { required: ['scenePath'] },
      };
    }
    const parentNodePath =
      maybeGetString(
        instanceArgs,
        ['parentNodePath', 'parent_node_path', 'parentPath'],
        'parentNodePath',
      ) ?? 'root';
    const name = maybeGetString(instanceArgs, ['name'], 'name');
    const props = asOptionalRecord(instanceArgs.props, 'props');

    const rpcParams: Record<string, unknown> = {
      scene_path: sourceScenePath,
      parent_path: parentNodePath,
    };
    if (name) rpcParams.name = name;
    if (props) rpcParams.props = props;
    if (ensureUniqueName !== undefined)
      rpcParams.ensure_unique_name = ensureUniqueName;

    assertEditorRpcAllowed(
      'instance_scene',
      rpcParams,
      ctx.getEditorProjectPath() ?? '',
    );
    return await callBaseTool(baseHandlers, 'godot_rpc', {
      request_json: { method: 'instance_scene', params: rpcParams },
      ...(localTimeout ? { timeoutMs: localTimeout } : {}),
    });
  }

  const projectPath = maybeGetString(
    instanceArgs,
    ['projectPath', 'project_path'],
    'projectPath',
  );
  const targetScenePath = maybeGetString(
    instanceArgs,
    ['scenePath', 'scene_path'],
    'scenePath',
  );
  const instanceScenePath = maybeGetString(
    instanceArgs,
    [
      'instanceScenePath',
      'instance_scene_path',
      'sourceScenePath',
      'source_scene_path',
    ],
    'instanceScenePath',
  );

  if (!projectPath || !targetScenePath || !instanceScenePath) {
    return {
      ok: false,
      summary:
        'Not connected to editor bridge; instance requires projectPath, scenePath (target) and instanceScenePath for headless mode',
      details: {
        required: ['projectPath', 'scenePath', 'instanceScenePath'],
        suggestions: [
          'Call godot_workspace_manager(action="connect") to instance scenes in the editor.',
          'Or pass projectPath + scenePath (target) + instanceScenePath (source) for headless mode.',
        ],
      },
    };
  }
  const parentNodePath =
    maybeGetString(
      instanceArgs,
      ['parentNodePath', 'parent_node_path', 'parentPath'],
      'parentNodePath',
    ) ?? 'root';
  const name = maybeGetString(instanceArgs, ['name'], 'name');
  const props = asOptionalRecord(instanceArgs.props, 'props');
  return await callBaseTool(baseHandlers, 'godot_headless_op', {
    projectPath,
    operation: 'instance_scene',
    params: {
      scenePath: targetScenePath,
      sourceScenePath: instanceScenePath,
      parentNodePath,
      ...(name ? { name } : {}),
      ...(props ? { props } : {}),
      ...(ensureUniqueName !== undefined ? { ensureUniqueName } : {}),
    },
  });
}
