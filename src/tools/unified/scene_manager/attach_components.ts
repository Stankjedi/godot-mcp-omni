import { asOptionalBoolean, asRecord } from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import { maybeGetString, type BaseToolHandlers } from '../shared.js';

import type { MaybeCaptureViewport } from './capture_viewport.js';
import { handleBatchCreate } from './batch_create.js';

export async function handleAttachComponents(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  componentArgs: Record<string, unknown>,
  timeoutMs: number | undefined,
  maybeCaptureViewport: MaybeCaptureViewport,
): Promise<ToolResponse> {
  const nodePath = maybeGetString(
    componentArgs,
    ['nodePath', 'node_path', 'parentNodePath', 'parent_node_path'],
    'nodePath',
  );
  const components =
    componentArgs.components ??
    (componentArgs as Record<string, unknown>).items ??
    (componentArgs as Record<string, unknown>).nodes;
  if (!nodePath || !Array.isArray(components)) {
    return {
      ok: false,
      summary: 'attach_components requires nodePath and components (array)',
      details: { required: ['nodePath', 'components'] },
    };
  }
  const ensureUniqueName =
    asOptionalBoolean(
      (componentArgs as Record<string, unknown>).ensureUniqueName ??
        (componentArgs as Record<string, unknown>).ensure_unique_name,
      'ensureUniqueName',
    ) ?? true;
  const enriched = components.map((item, index) => {
    const obj = asRecord(item, `components[${index}]`);
    const objEnsure =
      asOptionalBoolean(
        obj.ensureUniqueName ?? obj.ensure_unique_name,
        `components[${index}].ensureUniqueName`,
      ) ?? ensureUniqueName;
    return {
      parentNodePath: nodePath,
      ensureUniqueName: objEnsure,
      ...obj,
    };
  });
  return await handleBatchCreate(
    ctx,
    baseHandlers,
    { ...componentArgs, items: enriched },
    timeoutMs,
    maybeCaptureViewport,
  );
}
