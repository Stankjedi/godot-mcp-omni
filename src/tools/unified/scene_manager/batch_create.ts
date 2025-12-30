import { asOptionalBoolean, asRecord } from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import {
  maybeGetString,
  normalizeAction,
  type BaseToolHandlers,
} from '../shared.js';

import type { MaybeCaptureViewport } from './capture_viewport.js';
import { handleCreate } from './create.js';
import { handleInstance } from './instance.js';
import { handleUpdate } from './update.js';

export async function handleBatchCreate(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  batchArgs: Record<string, unknown>,
  timeoutMs: number | undefined,
  maybeCaptureViewport: MaybeCaptureViewport,
): Promise<ToolResponse> {
  const itemsValue =
    batchArgs.items ??
    (batchArgs as Record<string, unknown>).nodes ??
    (batchArgs as Record<string, unknown>).batch;
  if (!Array.isArray(itemsValue)) {
    return {
      ok: false,
      summary: 'batch_create requires items (array)',
      details: { required: ['items'] },
    };
  }
  const stopOnError =
    asOptionalBoolean(
      batchArgs.stopOnError ??
        (batchArgs as Record<string, unknown>).stop_on_error,
      'stopOnError',
    ) ?? true;
  const results: ToolResponse[] = [];
  let failedIndex: number | undefined;

  for (let i = 0; i < itemsValue.length; i += 1) {
    const itemObj = asRecord(itemsValue[i], `items[${i}]`);
    const itemActionRaw = maybeGetString(
      itemObj,
      ['action', 'op', 'operation'],
      `items[${i}].action`,
    );
    const itemAction = itemActionRaw
      ? normalizeAction(itemActionRaw)
      : 'create';
    const merged: Record<string, unknown> = { ...batchArgs, ...itemObj };
    delete merged.items;
    delete merged.nodes;
    delete merged.batch;
    delete merged.stopOnError;
    delete merged.stop_on_error;
    let result: ToolResponse;
    if (itemAction === 'create') {
      result = await handleCreate(
        ctx,
        baseHandlers,
        merged,
        timeoutMs,
        maybeCaptureViewport,
      );
    } else if (itemAction === 'instance') {
      result = await handleInstance(ctx, baseHandlers, merged, timeoutMs);
    } else if (itemAction === 'update') {
      result = await handleUpdate(
        ctx,
        baseHandlers,
        merged,
        timeoutMs,
        maybeCaptureViewport,
      );
    } else {
      result = {
        ok: false,
        summary: `Unsupported batch_create action: ${itemAction}`,
      };
    }
    results.push(result);
    if (!result.ok && failedIndex === undefined) {
      failedIndex = i;
      if (stopOnError) break;
    }
  }
  if (failedIndex !== undefined) {
    return {
      ok: false,
      summary: `batch_create failed at index ${failedIndex}`,
      details: { results, failedIndex },
    };
  }
  return {
    ok: true,
    summary: 'batch_create completed',
    details: { results },
  };
}
