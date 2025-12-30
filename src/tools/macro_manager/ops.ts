import type { MacroOp } from './types.js';

export function getStringField(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

export function opWriteTextFile(path: string, content: string): MacroOp {
  return { operation: 'write_text_file', params: { path, content } };
}

export function opCreateScene(
  scenePath: string,
  rootNodeType: string,
): MacroOp {
  return {
    operation: 'create_scene',
    params: { scenePath, rootNodeType },
  };
}

export function opAddNode(
  scenePath: string,
  parentNodePath: string,
  nodeType: string,
  nodeName: string,
  properties?: Record<string, unknown>,
): MacroOp {
  return {
    operation: 'add_node',
    params: {
      scenePath,
      parentNodePath,
      nodeType,
      nodeName,
      ...(properties ? { properties } : {}),
      ensureUniqueName: true,
    },
  };
}

export function opAttachScript(
  scenePath: string,
  nodePath: string,
  scriptPath: string,
): MacroOp {
  return {
    operation: 'attach_script',
    params: { scenePath, nodePath, scriptPath },
  };
}

export function opValidateScene(scenePath: string): MacroOp {
  return { operation: 'validate_scene', params: { scenePath } };
}
