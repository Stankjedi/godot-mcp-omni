import {
  asOptionalRecord,
  asOptionalString,
  ValidationError,
  valueType,
} from '../../validation.js';

import type { ServerContext } from '../context.js';
import type { ToolHandler, ToolResponse } from '../types.js';

export type BaseToolHandlers = Record<string, ToolHandler>;

export function supportedActionError(
  toolName: string,
  action: string,
  supportedActions: string[],
): ToolResponse {
  return {
    ok: false,
    summary: `Unknown action: ${action}`,
    error: {
      code: 'E_SCHEMA_VALIDATION',
      message: `Unknown action: ${action}`,
      details: { tool: toolName, supportedActions },
      retryable: true,
      suggestedFix:
        'Use a supported action or call meta_tool_manager(action="tool_help").',
    },
    details: { tool: toolName, supportedActions },
  };
}

export function hasEditorConnection(ctx: ServerContext): boolean {
  const client = ctx.getEditorClient();
  const projectPath = ctx.getEditorProjectPath();
  return Boolean(client && client.isConnected && projectPath);
}

export function requireEditorConnected(toolName: string): ToolResponse {
  return {
    ok: false,
    summary: `${toolName} requires an editor bridge connection`,
    error: {
      code: 'E_NOT_CONNECTED',
      message: `${toolName} requires an editor bridge connection`,
      details: {
        suggestions: ['Call godot_workspace_manager(action="connect")'],
      },
      retryable: true,
      suggestedFix: 'Call godot_workspace_manager(action="connect") and retry.',
    },
    details: {
      suggestions: ['Call godot_workspace_manager(action="connect")'],
    },
  };
}

export async function callBaseTool(
  baseHandlers: BaseToolHandlers,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const handler = baseHandlers[toolName];
  if (!handler) {
    return {
      ok: false,
      summary: `Internal error: missing handler for ${toolName}`,
      details: { toolName },
    };
  }
  return await handler(args);
}

export function normalizeAction(value: string): string {
  return value.trim().toLowerCase();
}

export function maybeGetString(
  argsObj: Record<string, unknown>,
  keys: string[],
  fieldName: string,
): string | undefined {
  for (const key of keys) {
    const v = asOptionalString(argsObj[key], fieldName);
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

export function normalizeScreenName(input: string): string {
  const trimmed = input.trim();
  const lowered = trimmed.toLowerCase();
  if (lowered === '2d') return '2D';
  if (lowered === '3d') return '3D';
  if (lowered === 'script' || lowered === 'code') return 'Script';
  return trimmed;
}

export type ResourceSpec = {
  type: string;
  props?: Record<string, unknown>;
  path?: string;
};

export function normalizeNodePath(input?: string): string {
  const trimmed = (input ?? 'root').trim();
  if (!trimmed || trimmed === '/' || trimmed === '/root') return 'root';
  if (trimmed.startsWith('/root/')) return `root/${trimmed.slice(6)}`;
  if (trimmed.startsWith('/')) return trimmed.slice(1);
  return trimmed;
}

export function joinNodePath(parentPath: string, nodeName: string): string {
  const parent = normalizeNodePath(parentPath);
  if (parent === 'root') return `root/${nodeName}`;
  return `${parent}/${nodeName}`;
}

export function isPhysicsBody3D(nodeType: string): boolean {
  const normalized = nodeType.trim();
  return (
    normalized === 'RigidBody3D' ||
    normalized === 'StaticBody3D' ||
    normalized === 'CharacterBody3D' ||
    normalized === 'VehicleBody3D' ||
    normalized === 'Area3D'
  );
}

export function isPhysicsBody2D(nodeType: string): boolean {
  const normalized = nodeType.trim();
  return (
    normalized === 'RigidBody2D' ||
    normalized === 'StaticBody2D' ||
    normalized === 'CharacterBody2D' ||
    normalized === 'Area2D'
  );
}

export function parseResourceSpec(
  value: unknown,
  fieldName: string,
): ResourceSpec | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const type = value.trim();
    if (!type) {
      throw new ValidationError(
        fieldName,
        `Invalid field "${fieldName}": expected non-empty string`,
        valueType(value),
      );
    }
    return { type };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected string or object`,
      valueType(value),
    );
  }
  const obj = value as Record<string, unknown>;
  const type =
    maybeGetString(
      obj,
      ['type', 'resourceType', 'resource', 'class', '$resource'],
      fieldName,
    ) ?? maybeGetString(obj, ['className'], fieldName);
  const pathValue = maybeGetString(
    obj,
    ['path', 'resourcePath', 'resource_path'],
    fieldName,
  );
  const resolvedType = type ?? pathValue;
  if (!resolvedType) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": missing resource type`,
      valueType(value),
    );
  }
  const props =
    asOptionalRecord(obj.props, `${fieldName}.props`) ??
    asOptionalRecord(obj.properties, `${fieldName}.properties`);
  return {
    type: resolvedType,
    ...(props ? { props } : {}),
    ...(pathValue ? { path: pathValue } : {}),
  };
}

export function toResourceJson(spec: ResourceSpec): Record<string, unknown> {
  return {
    $resource: spec.type,
    ...(spec.path ? { path: spec.path } : {}),
    ...(spec.props ? { props: spec.props } : {}),
  };
}

export function defaultVector3(
  x: number,
  y: number,
  z: number,
): Record<string, unknown> {
  return { $type: 'Vector3', x, y, z };
}

export function defaultVector2(x: number, y: number): Record<string, unknown> {
  return { $type: 'Vector2', x, y };
}

export function looksLikeResourcePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('res://') || trimmed.startsWith('user://'))
    return true;
  if (trimmed.includes('/')) return true;
  return /\.(png|jpe?g|webp|svg|tres|res|tscn|gd)$/iu.test(trimmed);
}

export function extractNodePath(resp: ToolResponse): string | undefined {
  const details = resp.details;
  if (!details || typeof details !== 'object' || Array.isArray(details))
    return undefined;
  const direct = (details as Record<string, unknown>).node_path;
  if (typeof direct === 'string') return direct;
  const result = (details as Record<string, unknown>).result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const nodePath = (result as Record<string, unknown>).node_path;
    if (typeof nodePath === 'string') return nodePath;
  }
  return undefined;
}

export function extractChildren(
  resp: ToolResponse,
): Array<Record<string, unknown>> {
  const details = resp.details;
  if (!details || typeof details !== 'object' || Array.isArray(details))
    return [];
  const result = (details as Record<string, unknown>).result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const children = (result as Record<string, unknown>).children;
    if (Array.isArray(children)) {
      return children.filter((child): child is Record<string, unknown> =>
        Boolean(child && typeof child === 'object' && !Array.isArray(child)),
      );
    }
  }
  if (Array.isArray((details as Record<string, unknown>).children)) {
    return (details as Record<string, unknown>).children as Array<
      Record<string, unknown>
    >;
  }
  return [];
}

export function resourcePathFromSpec(spec?: ResourceSpec): string | undefined {
  if (!spec) return undefined;
  if (spec.path && spec.path.trim()) return spec.path;
  if (looksLikeResourcePath(spec.type)) return spec.type;
  return undefined;
}

export function parseVector2Like(
  value: unknown,
): { x: number; y: number } | undefined {
  if (!value) return undefined;
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return undefined;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const x = Number(obj.x ?? obj.left);
    const y = Number(obj.y ?? obj.top);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return undefined;
}

export function layoutPresetProps(
  layoutRaw?: string,
): Record<string, number> | undefined {
  if (!layoutRaw) return undefined;
  const key = layoutRaw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, '');
  const presets: Record<string, Record<string, number>> = {
    full: {
      anchor_left: 0,
      anchor_top: 0,
      anchor_right: 1,
      anchor_bottom: 1,
      offset_left: 0,
      offset_top: 0,
      offset_right: 0,
      offset_bottom: 0,
    },
    fill: {
      anchor_left: 0,
      anchor_top: 0,
      anchor_right: 1,
      anchor_bottom: 1,
      offset_left: 0,
      offset_top: 0,
      offset_right: 0,
      offset_bottom: 0,
    },
    stretch: {
      anchor_left: 0,
      anchor_top: 0,
      anchor_right: 1,
      anchor_bottom: 1,
      offset_left: 0,
      offset_top: 0,
      offset_right: 0,
      offset_bottom: 0,
    },
    topleft: {
      anchor_left: 0,
      anchor_top: 0,
      anchor_right: 0,
      anchor_bottom: 0,
    },
    topright: {
      anchor_left: 1,
      anchor_top: 0,
      anchor_right: 1,
      anchor_bottom: 0,
    },
    bottomleft: {
      anchor_left: 0,
      anchor_top: 1,
      anchor_right: 0,
      anchor_bottom: 1,
    },
    bottomright: {
      anchor_left: 1,
      anchor_top: 1,
      anchor_right: 1,
      anchor_bottom: 1,
    },
    center: {
      anchor_left: 0.5,
      anchor_top: 0.5,
      anchor_right: 0.5,
      anchor_bottom: 0.5,
    },
    top: { anchor_left: 0, anchor_top: 0, anchor_right: 1, anchor_bottom: 0 },
    bottom: {
      anchor_left: 0,
      anchor_top: 1,
      anchor_right: 1,
      anchor_bottom: 1,
    },
    left: { anchor_left: 0, anchor_top: 0, anchor_right: 0, anchor_bottom: 1 },
    right: { anchor_left: 1, anchor_top: 0, anchor_right: 1, anchor_bottom: 1 },
  };
  return presets[key];
}

function maskFromIndices(indices: number[]): number {
  let mask = 0;
  for (const raw of indices) {
    const idx = Math.floor(raw);
    if (!Number.isFinite(idx) || idx < 1 || idx > 32) continue;
    mask |= 1 << (idx - 1);
  }
  return mask;
}

export function parseCollisionMask(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^\d+$/u.test(trimmed)) return Math.max(0, Math.floor(Number(trimmed)));
    const parts = trimmed.split(',').map((p) => Number(p.trim()));
    if (parts.every((p) => Number.isFinite(p))) return maskFromIndices(parts);
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": expected number or list of numbers`,
      valueType(value),
    );
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'boolean')) {
      const indices = value
        .map((v, idx) => (v ? idx + 1 : -1))
        .filter((v) => v > 0);
      return maskFromIndices(indices);
    }
    if (value.every((v) => typeof v === 'number')) {
      return maskFromIndices(value as number[]);
    }
  }
  throw new ValidationError(
    fieldName,
    `Invalid field "${fieldName}": expected number or array`,
    valueType(value),
  );
}

export type PrimitivePreset = {
  mesh?: ResourceSpec;
  shape?: ResourceSpec;
  sprite?: ResourceSpec;
};

const PRIMITIVE_PRESETS_3D: Record<string, PrimitivePreset> = {
  box: {
    mesh: { type: 'BoxMesh', props: { size: defaultVector3(1, 1, 1) } },
    shape: { type: 'BoxShape3D', props: { size: defaultVector3(1, 1, 1) } },
  },
  sphere: {
    mesh: { type: 'SphereMesh', props: { radius: 0.5 } },
    shape: { type: 'SphereShape3D', props: { radius: 0.5 } },
  },
  capsule: {
    mesh: { type: 'CapsuleMesh', props: { radius: 0.5, height: 1 } },
    shape: { type: 'CapsuleShape3D', props: { radius: 0.5, height: 1 } },
  },
  cylinder: {
    mesh: { type: 'CylinderMesh', props: { radius: 0.5, height: 1 } },
    shape: { type: 'CylinderShape3D', props: { radius: 0.5, height: 1 } },
  },
  plane: {
    mesh: { type: 'PlaneMesh', props: { size: defaultVector2(1, 1) } },
    shape: { type: 'BoxShape3D', props: { size: defaultVector3(1, 0.1, 1) } },
  },
  quad: {
    mesh: { type: 'QuadMesh', props: { size: defaultVector2(1, 1) } },
    shape: { type: 'BoxShape3D', props: { size: defaultVector3(1, 0.1, 1) } },
  },
  convex: { shape: { type: 'ConvexPolygonShape3D' } },
  concave: { shape: { type: 'ConcavePolygonShape3D' } },
};

const PRIMITIVE_PRESETS_2D: Record<string, PrimitivePreset> = {
  rect: {
    shape: {
      type: 'RectangleShape2D',
      props: { size: defaultVector2(64, 64) },
    },
  },
  circle: {
    shape: { type: 'CircleShape2D', props: { radius: 32 } },
  },
  capsule: {
    shape: { type: 'CapsuleShape2D', props: { radius: 16, height: 32 } },
  },
  segment: {
    shape: {
      type: 'SegmentShape2D',
      props: { a: defaultVector2(-32, 0), b: defaultVector2(32, 0) },
    },
  },
  convex: { shape: { type: 'ConvexPolygonShape2D' } },
  concave: { shape: { type: 'ConcavePolygonShape2D' } },
};

const PRESET_ALIASES_3D: Record<string, string> = {
  cube: 'box',
  square: 'box',
  rectangle: 'box',
  quad: 'quad',
  plane: 'plane',
};

const PRESET_ALIASES_2D: Record<string, string> = {
  box: 'rect',
  rectangle: 'rect',
  square: 'rect',
  sphere: 'circle',
  round: 'circle',
};

function normalizePresetKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, '');
}

export function resolvePrimitivePreset(
  presetRaw: string,
  use2D: boolean,
): PrimitivePreset | undefined {
  const key = normalizePresetKey(presetRaw);
  const alias = use2D
    ? (PRESET_ALIASES_2D[key] ?? key)
    : (PRESET_ALIASES_3D[key] ?? key);
  return use2D ? PRIMITIVE_PRESETS_2D[alias] : PRIMITIVE_PRESETS_3D[alias];
}

export function resolveMeshPreset(presetRaw: string): ResourceSpec | undefined {
  const key = normalizePresetKey(presetRaw);
  const alias = PRESET_ALIASES_3D[key] ?? key;
  return PRIMITIVE_PRESETS_3D[alias]?.mesh;
}

export function resolveShapePreset(
  presetRaw: string,
  use2D: boolean,
): ResourceSpec | undefined {
  const key = normalizePresetKey(presetRaw);
  const alias = use2D
    ? (PRESET_ALIASES_2D[key] ?? key)
    : (PRESET_ALIASES_3D[key] ?? key);
  return use2D
    ? PRIMITIVE_PRESETS_2D[alias]?.shape
    : PRIMITIVE_PRESETS_3D[alias]?.shape;
}
