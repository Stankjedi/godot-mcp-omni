import { assertEditorRpcAllowed } from '../../../security.js';
import {
  asOptionalBoolean,
  asOptionalPositiveNumber,
} from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import {
  callBaseTool,
  hasEditorConnection,
  type BaseToolHandlers,
} from '../shared.js';

export type MaybeCaptureViewport = (
  args: Record<string, unknown>,
  response: ToolResponse,
) => Promise<ToolResponse>;

export function createMaybeCaptureViewport(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): MaybeCaptureViewport {
  return async (
    args: Record<string, unknown>,
    response: ToolResponse,
  ): Promise<ToolResponse> => {
    const capture =
      asOptionalBoolean(
        args.captureViewport ??
          (args as Record<string, unknown>).capture_viewport ??
          (args as Record<string, unknown>).preview,
        'captureViewport',
      ) ?? false;
    if (!capture || !response.ok || !hasEditorConnection(ctx)) return response;

    const maxSize = asOptionalPositiveNumber(
      (args as Record<string, unknown>).maxSize ??
        (args as Record<string, unknown>).previewMaxSize,
      'maxSize',
    );
    const rpcParams: Record<string, unknown> = {};
    if (maxSize !== undefined) rpcParams.max_size = maxSize;
    assertEditorRpcAllowed(
      'viewport.capture',
      rpcParams,
      ctx.getEditorProjectPath() ?? '',
    );
    const captureResp = await callBaseTool(baseHandlers, 'godot_rpc', {
      request_json: { method: 'viewport.capture', params: rpcParams },
    });

    return {
      ...response,
      details: {
        ...(response.details ?? {}),
        preview: captureResp,
      },
    };
  };
}
