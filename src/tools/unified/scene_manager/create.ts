import path from 'path';

import { assertEditorRpcAllowed } from '../../../security.js';
import {
  asOptionalBoolean,
  asOptionalPositiveNumber,
  asOptionalRecord,
} from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import {
  callBaseTool,
  defaultVector2,
  defaultVector3,
  extractChildren,
  extractNodePath,
  hasEditorConnection,
  isPhysicsBody2D,
  isPhysicsBody3D,
  joinNodePath,
  maybeGetString,
  normalizeNodePath,
  parseResourceSpec,
  resourcePathFromSpec,
  resolveMeshPreset,
  resolvePrimitivePreset,
  resolveShapePreset,
  toResourceJson,
  type BaseToolHandlers,
  type ResourceSpec,
} from '../shared.js';

import type { MaybeCaptureViewport } from './capture_viewport.js';
import { inferUse2D, resolveCollisionMask } from './parsing.js';

export async function handleCreate(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  createArgs: Record<string, unknown>,
  timeoutMs: number | undefined,
  maybeCaptureViewport: MaybeCaptureViewport,
): Promise<ToolResponse> {
  const localTimeout =
    asOptionalPositiveNumber(createArgs.timeoutMs, 'timeoutMs') ?? timeoutMs;
  const nodeType = maybeGetString(
    createArgs,
    ['nodeType', 'type', 'node_type'],
    'nodeType',
  );
  const nodeName = maybeGetString(
    createArgs,
    ['nodeName', 'name', 'node_name'],
    'nodeName',
  );
  if (!nodeType || !nodeName) {
    return {
      ok: false,
      summary: 'create requires nodeType and nodeName',
      details: {
        required: ['nodeType', 'nodeName'],
        suggestions: [
          'Example: godot_scene_manager(action="create", nodeType="Node2D", nodeName="Player", parentNodePath="root")',
        ],
      },
    };
  }

  const parentNodePath =
    maybeGetString(
      createArgs,
      ['parentNodePath', 'parentPath', 'parent_node_path', 'targetPath'],
      'parentNodePath',
    ) ?? 'root';

  const props =
    asOptionalRecord(createArgs.props, 'props') ??
    asOptionalRecord(createArgs.properties, 'properties');

  const autoAttach = asOptionalBoolean(
    createArgs.autoAttach ??
      (createArgs as Record<string, unknown>).auto_attach ??
      (createArgs as Record<string, unknown>).attachDefaults ??
      (createArgs as Record<string, unknown>).attach_defaults,
    'autoAttach',
  );
  const dimensionRaw = maybeGetString(
    createArgs,
    ['dimension', 'space', 'dim'],
    'dimension',
  );
  const use2D = inferUse2D(nodeType, dimensionRaw);

  const ensureUniqueName =
    asOptionalBoolean(
      createArgs.ensureUniqueName ??
        (createArgs as Record<string, unknown>).ensure_unique_name ??
        (createArgs as Record<string, unknown>).uniqueName,
      'ensureUniqueName',
    ) ?? true;
  const ensureChildUniqueName =
    asOptionalBoolean(
      (createArgs as Record<string, unknown>).ensureChildUniqueName ??
        (createArgs as Record<string, unknown>).ensure_child_unique_name ??
        (createArgs as Record<string, unknown>).ensureUniqueChildren,
      'ensureChildUniqueName',
    ) ?? true;

  const primitivePresetRaw = maybeGetString(
    createArgs,
    ['primitive', 'primitivePreset', 'primitiveType'],
    'primitive',
  );
  const meshPresetRaw = maybeGetString(
    createArgs,
    ['meshPreset', 'meshPrimitive', 'meshShape'],
    'meshPreset',
  );
  const shapePresetRaw = maybeGetString(
    createArgs,
    ['shapePreset', 'collisionPreset', 'collisionShape'],
    'shapePreset',
  );

  let meshSpec = parseResourceSpec(
    createArgs.mesh ?? (createArgs as Record<string, unknown>).meshSpec,
    'mesh',
  );
  let shapeSpec = parseResourceSpec(
    createArgs.shape ?? (createArgs as Record<string, unknown>).shapeSpec,
    'shape',
  );
  let spriteSpec = parseResourceSpec(
    createArgs.sprite ??
      (createArgs as Record<string, unknown>).texture ??
      (createArgs as Record<string, unknown>).spriteTexture ??
      (createArgs as Record<string, unknown>).texturePath,
    'sprite',
  );

  if (primitivePresetRaw) {
    const preset = resolvePrimitivePreset(primitivePresetRaw, use2D);
    if (preset) {
      if (!meshSpec && preset.mesh) meshSpec = preset.mesh;
      if (!shapeSpec && preset.shape) shapeSpec = preset.shape;
      if (!spriteSpec && preset.sprite) spriteSpec = preset.sprite;
    }
  }
  if (!meshSpec && meshPresetRaw) {
    const presetMesh = resolveMeshPreset(meshPresetRaw);
    if (presetMesh) meshSpec = presetMesh;
  }
  if (!shapeSpec && shapePresetRaw) {
    const presetShape = resolveShapePreset(shapePresetRaw, use2D);
    if (presetShape) shapeSpec = presetShape;
  }

  const meshNodeType =
    maybeGetString(
      createArgs,
      ['meshNodeType', 'mesh_node_type'],
      'meshNodeType',
    ) ?? 'MeshInstance3D';
  const shapeNodeType =
    maybeGetString(
      createArgs,
      ['shapeNodeType', 'shape_node_type'],
      'shapeNodeType',
    ) ?? (use2D ? 'CollisionShape2D' : 'CollisionShape3D');
  const spriteNodeType =
    maybeGetString(
      createArgs,
      ['spriteNodeType', 'sprite_node_type'],
      'spriteNodeType',
    ) ?? 'Sprite2D';
  const meshNodeName =
    maybeGetString(
      createArgs,
      ['meshNodeName', 'mesh_node_name'],
      'meshNodeName',
    ) ?? `${nodeName}_Mesh`;
  const shapeNodeName =
    maybeGetString(
      createArgs,
      ['shapeNodeName', 'shape_node_name'],
      'shapeNodeName',
    ) ?? (use2D ? `${nodeName}_Collider2D` : `${nodeName}_Collider`);
  const spriteNodeName =
    maybeGetString(
      createArgs,
      ['spriteNodeName', 'sprite_node_name'],
      'spriteNodeName',
    ) ?? `${nodeName}_Sprite`;

  const meshNodeProps = asOptionalRecord(
    (createArgs as Record<string, unknown>).meshProps,
    'meshProps',
  );
  const shapeNodeProps = asOptionalRecord(
    (createArgs as Record<string, unknown>).shapeProps,
    'shapeProps',
  );
  const spriteNodeProps = asOptionalRecord(
    (createArgs as Record<string, unknown>).spriteProps,
    'spriteProps',
  );

  const shouldAutoAttach =
    autoAttach ?? (isPhysicsBody3D(nodeType) || isPhysicsBody2D(nodeType));
  const defaultMeshSpec: ResourceSpec = {
    type: 'BoxMesh',
    props: { size: defaultVector3(1, 1, 1) },
  };
  const defaultShape3D: ResourceSpec = {
    type: 'BoxShape3D',
    props: { size: defaultVector3(1, 1, 1) },
  };
  const defaultShape2D: ResourceSpec = {
    type: 'RectangleShape2D',
    props: { size: defaultVector2(64, 64) },
  };

  let meshSpecFinal =
    meshSpec ?? (shouldAutoAttach && !use2D ? defaultMeshSpec : undefined);
  let shapeSpecFinal =
    shapeSpec ??
    (shouldAutoAttach ? (use2D ? defaultShape2D : defaultShape3D) : undefined);
  let spriteSpecFinal = spriteSpec;
  const spriteTexturePath = resourcePathFromSpec(spriteSpecFinal);

  const rootIsMesh = nodeType === 'MeshInstance3D';
  const rootIsSprite =
    nodeType === 'Sprite2D' ||
    nodeType === 'Sprite3D' ||
    nodeType === 'TextureRect';
  const rootIsShape =
    nodeType === 'CollisionShape3D' || nodeType === 'CollisionShape2D';

  const collisionLayer = resolveCollisionMask(
    createArgs.collisionLayer ??
      (createArgs as Record<string, unknown>).collision_layer ??
      (createArgs as Record<string, unknown>).collisionLayers ??
      (createArgs as Record<string, unknown>).collision_layers,
    (createArgs as Record<string, unknown>).collisionLayerBits ??
      (createArgs as Record<string, unknown>).collision_layer_bits,
    'collisionLayer',
  );
  const collisionMask = resolveCollisionMask(
    createArgs.collisionMask ??
      (createArgs as Record<string, unknown>).collision_mask ??
      (createArgs as Record<string, unknown>).collisionMasks ??
      (createArgs as Record<string, unknown>).collision_masks,
    (createArgs as Record<string, unknown>).collisionMaskBits ??
      (createArgs as Record<string, unknown>).collision_mask_bits,
    'collisionMask',
  );

  const rootProps: Record<string, unknown> = { ...(props ?? {}) };
  if (collisionLayer !== undefined) rootProps.collision_layer = collisionLayer;
  if (collisionMask !== undefined) rootProps.collision_mask = collisionMask;
  if (rootIsMesh && meshSpecFinal) {
    rootProps.mesh = toResourceJson(meshSpecFinal);
    meshSpecFinal = undefined;
  }
  if (rootIsSprite && spriteSpecFinal) {
    rootProps.texture = toResourceJson(spriteSpecFinal);
    spriteSpecFinal = undefined;
  }
  if (rootIsShape && shapeSpecFinal) {
    rootProps.shape = toResourceJson(shapeSpecFinal);
    shapeSpecFinal = undefined;
  }
  const rootPropsFinal =
    Object.keys(rootProps).length > 0 ? rootProps : undefined;

  const attachMesh = Boolean(meshSpecFinal);
  const attachShape = Boolean(shapeSpecFinal);
  const attachSprite =
    !rootIsSprite && (Boolean(spriteSpecFinal) || (shouldAutoAttach && use2D));

  const normalizedParent = normalizeNodePath(parentNodePath);
  const rootPath = joinNodePath(normalizedParent, nodeName);
  const autoImport =
    asOptionalBoolean(
      (createArgs as Record<string, unknown>).autoImport ??
        (createArgs as Record<string, unknown>).auto_import,
      'autoImport',
    ) ?? true;
  const autoLoadTexture =
    asOptionalBoolean(
      (createArgs as Record<string, unknown>).autoLoadTexture ??
        (createArgs as Record<string, unknown>).auto_load_texture,
      'autoLoadTexture',
    ) ?? true;

  const meshProps =
    attachMesh && meshSpecFinal
      ? { ...(meshNodeProps ?? {}), mesh: toResourceJson(meshSpecFinal) }
      : meshNodeProps;
  const shapeProps =
    attachShape && shapeSpecFinal
      ? { ...(shapeNodeProps ?? {}), shape: toResourceJson(shapeSpecFinal) }
      : shapeNodeProps;
  const spriteProps =
    attachSprite && spriteSpecFinal
      ? { ...(spriteNodeProps ?? {}), texture: toResourceJson(spriteSpecFinal) }
      : spriteNodeProps;

  const callEditorRpc = async (
    method: string,
    params: Record<string, unknown>,
  ): Promise<ToolResponse> =>
    callBaseTool(baseHandlers, 'godot_rpc', {
      request_json: { method, params },
      ...(localTimeout ? { timeoutMs: localTimeout } : {}),
    });

  const editorAddNode = async (
    params: Record<string, unknown>,
  ): Promise<{ response: ToolResponse; nodePath?: string }> => {
    const response = await callEditorRpc('add_node', params);
    return { response, nodePath: extractNodePath(response) };
  };

  if (hasEditorConnection(ctx)) {
    if (spriteTexturePath && autoImport) {
      const canImport =
        spriteTexturePath.startsWith('res://') ||
        !path.isAbsolute(spriteTexturePath);
      if (canImport) {
        const rpcParams: Record<string, unknown> = {
          files: [spriteTexturePath],
        };
        assertEditorRpcAllowed(
          'filesystem.reimport_files',
          rpcParams,
          ctx.getEditorProjectPath() ?? '',
        );
        await callBaseTool(baseHandlers, 'godot_rpc', {
          request_json: {
            method: 'filesystem.reimport_files',
            params: rpcParams,
          },
        });
      }
    }

    if (!attachMesh && !attachShape && !attachSprite) {
      const rpcParams: Record<string, unknown> = {
        parent_path: normalizedParent,
        type: nodeType,
        name: nodeName,
        ensure_unique_name: ensureUniqueName,
      };
      if (rootPropsFinal) rpcParams.props = rootPropsFinal;

      assertEditorRpcAllowed(
        'add_node',
        rpcParams,
        ctx.getEditorProjectPath() ?? '',
      );
      const resp = await callEditorRpc('add_node', rpcParams);
      return await maybeCaptureViewport(createArgs, resp);
    }

    const beginResp = await callEditorRpc('begin_action', {
      name: 'godot_scene_manager:create',
    });
    if (!beginResp.ok) return beginResp;

    const rootResp = await editorAddNode({
      parent_path: normalizedParent,
      type: nodeType,
      name: nodeName,
      ensure_unique_name: ensureUniqueName,
      ...(rootPropsFinal ? { props: rootPropsFinal } : {}),
    });
    if (!rootResp.response.ok) {
      await callEditorRpc('abort_action', {});
      return rootResp.response;
    }

    const resolvedRootPath = rootResp.nodePath ?? rootPath;
    const childResults: Array<Record<string, unknown>> = [];
    let spriteNodePath: string | undefined = rootIsSprite
      ? resolvedRootPath
      : undefined;

    if (attachMesh && meshSpecFinal) {
      const childResp = await editorAddNode({
        parent_path: resolvedRootPath,
        type: meshNodeType,
        name: meshNodeName,
        ensure_unique_name: ensureChildUniqueName,
        ...(meshProps ? { props: meshProps } : {}),
      });
      if (!childResp.response.ok) {
        await callEditorRpc('abort_action', {});
        return childResp.response;
      }
      childResults.push({
        role: 'mesh',
        node_path: childResp.nodePath,
        details: childResp.response.details ?? {},
      });
    }

    if (attachSprite) {
      const childResp = await editorAddNode({
        parent_path: resolvedRootPath,
        type: spriteNodeType,
        name: spriteNodeName,
        ensure_unique_name: ensureChildUniqueName,
        ...(spriteProps ? { props: spriteProps } : {}),
      });
      if (!childResp.response.ok) {
        await callEditorRpc('abort_action', {});
        return childResp.response;
      }
      spriteNodePath = childResp.nodePath;
      childResults.push({
        role: 'sprite',
        node_path: childResp.nodePath,
        details: childResp.response.details ?? {},
      });
    }

    if (attachShape && shapeSpecFinal) {
      const childResp = await editorAddNode({
        parent_path: resolvedRootPath,
        type: shapeNodeType,
        name: shapeNodeName,
        ensure_unique_name: ensureChildUniqueName,
        ...(shapeProps ? { props: shapeProps } : {}),
      });
      if (!childResp.response.ok) {
        await callEditorRpc('abort_action', {});
        return childResp.response;
      }
      childResults.push({
        role: 'shape',
        node_path: childResp.nodePath,
        details: childResp.response.details ?? {},
      });
    }

    const commitResp = await callEditorRpc('commit_action', {
      execute: true,
    });
    if (!commitResp.ok) return commitResp;

    const response = {
      ok: true,
      summary: 'create completed',
      details: {
        root: rootResp.response.details ?? {},
        root_path: resolvedRootPath,
        children: childResults,
        sprite_node_path: spriteNodePath,
        texture_path: spriteTexturePath,
      },
    };
    return await maybeCaptureViewport(createArgs, response);
  }

  const projectPath = maybeGetString(
    createArgs,
    ['projectPath', 'project_path'],
    'projectPath',
  );
  const scenePath = maybeGetString(
    createArgs,
    ['scenePath', 'scene_path'],
    'scenePath',
  );
  if (!projectPath || !scenePath) {
    return {
      ok: false,
      summary:
        'Not connected to editor bridge; create requires projectPath and scenePath for headless mode',
      details: {
        required: ['projectPath', 'scenePath'],
        suggestions: [
          'Call godot_workspace_manager(action="connect") to create nodes in the currently edited scene.',
          'Or pass projectPath + scenePath to edit the scene file headlessly.',
        ],
      },
    };
  }

  if (!attachMesh && !attachShape && !attachSprite) {
    const addResp = await callBaseTool(baseHandlers, 'add_node', {
      projectPath,
      scenePath,
      parentNodePath: normalizedParent,
      nodeType,
      nodeName,
      ...(rootPropsFinal ? { properties: rootPropsFinal } : {}),
      ...(ensureUniqueName ? { ensureUniqueName } : {}),
    });

    if (addResp.ok && autoLoadTexture && spriteTexturePath && rootIsSprite) {
      const nodePath = extractNodePath(addResp) ?? rootPath;
      const loadResp = await callBaseTool(baseHandlers, 'load_sprite', {
        projectPath,
        scenePath,
        nodePath,
        texturePath: spriteTexturePath,
      });
      return {
        ...addResp,
        details: {
          ...(addResp.details ?? {}),
          texture_load: loadResp,
        },
      };
    }

    return addResp;
  }

  const children: Array<Record<string, unknown>> = [];
  if (attachMesh && meshSpecFinal) {
    children.push({
      nodeType: meshNodeType,
      nodeName: meshNodeName,
      ...(meshProps ? { properties: meshProps } : {}),
      ensureUniqueName: ensureChildUniqueName,
      role: 'mesh',
    });
  }
  if (attachSprite) {
    children.push({
      nodeType: spriteNodeType,
      nodeName: spriteNodeName,
      ...(spriteProps ? { properties: spriteProps } : {}),
      ensureUniqueName: ensureChildUniqueName,
      role: 'sprite',
    });
  }
  if (attachShape && shapeSpecFinal) {
    children.push({
      nodeType: shapeNodeType,
      nodeName: shapeNodeName,
      ...(shapeProps ? { properties: shapeProps } : {}),
      ensureUniqueName: ensureChildUniqueName,
      role: 'shape',
    });
  }

  const bundleResp = await callBaseTool(baseHandlers, 'godot_headless_op', {
    projectPath,
    operation: 'create_node_bundle',
    params: {
      scenePath,
      parentNodePath: normalizedParent,
      nodeType,
      nodeName,
      ...(rootPropsFinal ? { properties: rootPropsFinal } : {}),
      ensureUniqueName,
      children,
    },
  });

  if (
    bundleResp.ok &&
    autoLoadTexture &&
    spriteTexturePath &&
    (rootIsSprite || attachSprite)
  ) {
    const rootNodePath = extractNodePath(bundleResp) ?? rootPath;
    const childrenInfo = extractChildren(bundleResp);
    const spriteChild = childrenInfo.find((child) => child.role === 'sprite');
    const spriteNodePath = rootIsSprite
      ? rootNodePath
      : typeof spriteChild?.node_path === 'string'
        ? (spriteChild.node_path as string)
        : undefined;
    if (spriteNodePath) {
      const loadResp = await callBaseTool(baseHandlers, 'load_sprite', {
        projectPath,
        scenePath,
        nodePath: spriteNodePath,
        texturePath: spriteTexturePath,
      });
      return {
        ...bundleResp,
        details: {
          ...(bundleResp.details ?? {}),
          texture_load: loadResp,
        },
      };
    }
  }

  return bundleResp;
}
