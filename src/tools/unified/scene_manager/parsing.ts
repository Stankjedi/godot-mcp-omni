import {
  isPhysicsBody2D,
  isPhysicsBody3D,
  parseCollisionMask,
} from '../shared.js';

export function inferUse2D(
  nodeType: string,
  dimensionRaw: string | undefined,
): boolean {
  const dimension = dimensionRaw?.trim().toLowerCase();
  const inferred2D = nodeType.endsWith('2D') || isPhysicsBody2D(nodeType);
  const inferred3D = nodeType.endsWith('3D') || isPhysicsBody3D(nodeType);
  return (
    dimension === '2d' || (dimension !== '3d' && inferred2D && !inferred3D)
  );
}

export function resolveCollisionMask(
  raw: unknown,
  bits: unknown,
  fieldName: string,
): number | undefined {
  if (bits !== undefined && bits !== null)
    return parseCollisionMask(bits, fieldName);
  if (raw !== undefined && raw !== null)
    return parseCollisionMask(raw, fieldName);
  return undefined;
}
