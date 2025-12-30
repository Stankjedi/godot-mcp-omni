import { assertEditorRpcAllowed } from '../../../security.js';
import {
  asOptionalBoolean,
  asOptionalNonNegativeInteger,
  asOptionalPositiveNumber,
  asOptionalRecord,
} from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import {
  callBaseTool,
  hasEditorConnection,
  maybeGetString,
  normalizeNodePath,
  parseResourceSpec,
  toResourceJson,
  type BaseToolHandlers,
} from '../shared.js';

import type { MaybeCaptureViewport } from './capture_viewport.js';

export async function handleCreateTilemap(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  tileArgs: Record<string, unknown>,
  timeoutMs: number | undefined,
  maybeCaptureViewport: MaybeCaptureViewport,
): Promise<ToolResponse> {
  const localTimeout =
    asOptionalPositiveNumber(tileArgs.timeoutMs, 'timeoutMs') ?? timeoutMs;
  const nodeName = maybeGetString(
    tileArgs,
    ['nodeName', 'name', 'node_name'],
    'nodeName',
  );
  if (!nodeName) {
    return {
      ok: false,
      summary: 'create_tilemap requires nodeName',
      details: { required: ['nodeName'] },
    };
  }
  const nodeType =
    maybeGetString(tileArgs, ['nodeType', 'node_type'], 'nodeType') ??
    'TileMap';
  const parentNodePath =
    maybeGetString(
      tileArgs,
      ['parentNodePath', 'parent_node_path', 'parentPath'],
      'parentNodePath',
    ) ?? 'root';
  const propsBase =
    asOptionalRecord(tileArgs.props, 'props') ??
    asOptionalRecord(tileArgs.properties, 'properties');
  const tileSetSpec = parseResourceSpec(
    tileArgs.tileSet ?? (tileArgs as Record<string, unknown>).tile_set,
    'tileSet',
  );
  const tileSetTexturePath = maybeGetString(
    tileArgs,
    ['tileSetTexturePath', 'tile_set_texture_path', 'tilesetTexturePath'],
    'tileSetTexturePath',
  );
  const tileSetPath = maybeGetString(
    tileArgs,
    ['tileSetPath', 'tile_set_path', 'tilesetPath'],
    'tileSetPath',
  );
  const tileSize =
    (tileArgs as Record<string, unknown>).tileSize ??
    (tileArgs as Record<string, unknown>).tile_size;
  const ensureUniqueName =
    asOptionalBoolean(
      (tileArgs as Record<string, unknown>).ensureUniqueName ??
        (tileArgs as Record<string, unknown>).ensure_unique_name,
      'ensureUniqueName',
    ) ?? true;
  const cells = (tileArgs as Record<string, unknown>).cells;
  const layer = asOptionalNonNegativeInteger(
    (tileArgs as Record<string, unknown>).layer,
    'layer',
  );

  const tileProps: Record<string, unknown> = {
    ...(propsBase ?? {}),
    ...(tileSetSpec ? { tile_set: toResourceJson(tileSetSpec) } : {}),
  };
  const normalizedParent = normalizeNodePath(parentNodePath);

  if (hasEditorConnection(ctx)) {
    const rpcParams: Record<string, unknown> = {
      parent_path: normalizedParent,
      node_type: nodeType,
      node_name: nodeName,
      ensure_unique_name: ensureUniqueName,
      ...(Object.keys(tileProps).length > 0 ? { props: tileProps } : {}),
      ...(Array.isArray(cells) ? { cells } : {}),
      ...(layer !== undefined ? { layer } : {}),
      ...(tileSetTexturePath
        ? { tile_set_texture_path: tileSetTexturePath }
        : {}),
      ...(tileSetPath ? { tile_set_path: tileSetPath } : {}),
      ...(tileSize ? { tile_size: tileSize } : {}),
    };
    assertEditorRpcAllowed(
      'create_tilemap',
      rpcParams,
      ctx.getEditorProjectPath() ?? '',
    );
    const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
      request_json: { method: 'create_tilemap', params: rpcParams },
      ...(localTimeout ? { timeoutMs: localTimeout } : {}),
    });
    return await maybeCaptureViewport(tileArgs, resp);
  }

  const projectPath = maybeGetString(
    tileArgs,
    ['projectPath', 'project_path'],
    'projectPath',
  );
  const scenePath = maybeGetString(
    tileArgs,
    ['scenePath', 'scene_path'],
    'scenePath',
  );
  if (!projectPath || !scenePath) {
    return {
      ok: false,
      summary:
        'Not connected to editor bridge; create_tilemap requires projectPath and scenePath for headless mode',
      details: { required: ['projectPath', 'scenePath'] },
    };
  }

  const resp = await callBaseTool(baseHandlers, 'godot_headless_op', {
    projectPath,
    operation: 'create_tilemap',
    params: {
      scenePath,
      parentNodePath: normalizedParent,
      nodeType,
      nodeName,
      ...(Object.keys(tileProps).length > 0 ? { props: tileProps } : {}),
      ...(Array.isArray(cells) ? { cells } : {}),
      ...(layer !== undefined ? { layer } : {}),
      ...(tileSetTexturePath ? { tileSetTexturePath } : {}),
      ...(tileSetPath ? { tileSetPath } : {}),
      ...(tileSize ? { tileSize } : {}),
      ...(ensureUniqueName ? { ensureUniqueName } : {}),
    },
  });
  return await maybeCaptureViewport(tileArgs, resp);
}
