import {
  asOptionalPositiveNumber,
  asOptionalRecord,
} from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import {
  callBaseTool,
  hasEditorConnection,
  maybeGetString,
  parseResourceSpec,
  toResourceJson,
  type BaseToolHandlers,
} from '../shared.js';

import type { MaybeCaptureViewport } from './capture_viewport.js';
import { resolveCollisionMask } from './parsing.js';

export async function handleUpdate(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  updateArgs: Record<string, unknown>,
  timeoutMs: number | undefined,
  maybeCaptureViewport: MaybeCaptureViewport,
): Promise<ToolResponse> {
  const localTimeout =
    asOptionalPositiveNumber(updateArgs.timeoutMs, 'timeoutMs') ?? timeoutMs;
  const nodePath = maybeGetString(
    updateArgs,
    ['nodePath', 'node_path'],
    'nodePath',
  );
  const propsBase =
    asOptionalRecord(updateArgs.props, 'props') ??
    asOptionalRecord(updateArgs.properties, 'properties');
  const meshSpec = parseResourceSpec(
    updateArgs.mesh ?? (updateArgs as Record<string, unknown>).meshSpec,
    'mesh',
  );
  const shapeSpec = parseResourceSpec(
    updateArgs.shape ?? (updateArgs as Record<string, unknown>).shapeSpec,
    'shape',
  );
  const spriteSpec = parseResourceSpec(
    updateArgs.sprite ??
      (updateArgs as Record<string, unknown>).texture ??
      (updateArgs as Record<string, unknown>).spriteTexture ??
      (updateArgs as Record<string, unknown>).texturePath,
    'sprite',
  );
  const scriptSpec = parseResourceSpec(
    (updateArgs as Record<string, unknown>).script ??
      (updateArgs as Record<string, unknown>).scriptPath,
    'script',
  );

  const props: Record<string, unknown> = { ...(propsBase ?? {}) };
  const collisionLayer = resolveCollisionMask(
    updateArgs.collisionLayer ??
      (updateArgs as Record<string, unknown>).collision_layer ??
      (updateArgs as Record<string, unknown>).collisionLayers ??
      (updateArgs as Record<string, unknown>).collision_layers,
    (updateArgs as Record<string, unknown>).collisionLayerBits ??
      (updateArgs as Record<string, unknown>).collision_layer_bits,
    'collisionLayer',
  );
  const collisionMask = resolveCollisionMask(
    updateArgs.collisionMask ??
      (updateArgs as Record<string, unknown>).collision_mask ??
      (updateArgs as Record<string, unknown>).collisionMasks ??
      (updateArgs as Record<string, unknown>).collision_masks,
    (updateArgs as Record<string, unknown>).collisionMaskBits ??
      (updateArgs as Record<string, unknown>).collision_mask_bits,
    'collisionMask',
  );
  if (collisionLayer !== undefined) props.collision_layer = collisionLayer;
  if (collisionMask !== undefined) props.collision_mask = collisionMask;
  if (meshSpec && props.mesh === undefined)
    props.mesh = toResourceJson(meshSpec);
  if (shapeSpec && props.shape === undefined)
    props.shape = toResourceJson(shapeSpec);
  if (spriteSpec && props.texture === undefined)
    props.texture = toResourceJson(spriteSpec);
  if (scriptSpec && props.script === undefined)
    props.script = toResourceJson(scriptSpec);

  if (!nodePath || Object.keys(props).length === 0) {
    return {
      ok: false,
      summary: 'update requires nodePath and at least one property',
      details: { required: ['nodePath', 'props'] },
    };
  }

  if (hasEditorConnection(ctx)) {
    const steps = Object.entries(props).map(([property, value]) => ({
      method: 'set_property',
      params: { node_path: nodePath, property, value },
    }));
    const resp = await callBaseTool(baseHandlers, 'godot_editor_batch', {
      actionName: 'godot_scene_manager:update',
      steps,
      ...(localTimeout ? { timeoutMs: localTimeout } : {}),
    });
    return await maybeCaptureViewport(updateArgs, resp);
  }

  const projectPath = maybeGetString(
    updateArgs,
    ['projectPath', 'project_path'],
    'projectPath',
  );
  const scenePath = maybeGetString(
    updateArgs,
    ['scenePath', 'scene_path'],
    'scenePath',
  );
  if (!projectPath || !scenePath) {
    return {
      ok: false,
      summary:
        'Not connected to editor bridge; update requires projectPath and scenePath for headless mode',
      details: {
        required: ['projectPath', 'scenePath'],
        suggestions: [
          'Call godot_workspace_manager(action="connect") to update nodes in the currently edited scene.',
          'Or pass projectPath + scenePath to edit the scene file headlessly.',
        ],
      },
    };
  }

  const resp = await callBaseTool(baseHandlers, 'godot_headless_op', {
    projectPath,
    operation: 'set_node_properties',
    params: { scenePath, nodePath, props },
  });
  return await maybeCaptureViewport(updateArgs, resp);
}
