import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNumber,
  asRecord,
} from '../../validation.js';

import type { ServerContext } from '../context.js';
import type { ToolHandler, ToolResponse } from '../types.js';

import {
  callBaseTool,
  hasEditorConnection,
  normalizeAction,
  requireEditorConnected,
  supportedActionError,
  type BaseToolHandlers,
} from './shared.js';

type ParsedError = {
  level: 'error' | 'warning';
  message: string;
  file: string | null;
  line: number | null;
};

function toLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trimEnd())
    .filter((v) => v.trim().length > 0);
}

function parseGodotErrorLine(line: string): ParsedError | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const level: ParsedError['level'] =
    /warning/iu.test(trimmed) && !/error/iu.test(trimmed) ? 'warning' : 'error';

  const pathMatch = trimmed.match(
    /(res:\/\/[^\s:]+?\.(?:gd|gdscript|tscn|tres|res))(?::(\d+))?/iu,
  );

  const file = pathMatch?.[1] ?? null;
  const lineNumberRaw = pathMatch?.[2];
  const lineNumber =
    typeof lineNumberRaw === 'string' && /^\d+$/u.test(lineNumberRaw)
      ? Number.parseInt(lineNumberRaw, 10)
      : null;

  return { level, message: trimmed, file, line: lineNumber };
}

function filterErrorLike(lines: string[], pattern: RegExp | null): string[] {
  const base = pattern
    ? lines.filter((l) => pattern.test(l))
    : lines.filter((l) => /error|exception|panic|failed|parse error/iu.test(l));
  return base;
}

export function createLogManagerHandler(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): ToolHandler {
  return async (args: unknown): Promise<ToolResponse> => {
    const argsObj = asRecord(args, 'args');
    const actionRaw = asNonEmptyString(argsObj.action, 'action');
    const action = normalizeAction(actionRaw);

    const supportedActions = ['poll', 'tail'];

    if (!hasEditorConnection(ctx))
      return requireEditorConnected('godot_log_manager');

    const maxBytes = Math.floor(
      asOptionalNumber(argsObj.maxBytes, 'maxBytes') ?? 64 * 1024,
    );
    const timeoutMs =
      Math.floor(asOptionalNumber(argsObj.timeoutMs, 'timeoutMs') ?? 0) ||
      undefined;

    const onlyErrors =
      asOptionalBoolean(argsObj.onlyErrors, 'onlyErrors') ?? true;
    const openScriptOnError =
      asOptionalBoolean(argsObj.openScriptOnError, 'openScriptOnError') ??
      false;
    const maxMatches = Math.floor(
      asOptionalNumber(argsObj.maxMatches, 'maxMatches') ?? 50,
    );

    const rawPattern =
      typeof argsObj.pattern === 'string' ? argsObj.pattern.trim() : '';
    const pattern = rawPattern ? new RegExp(rawPattern, 'iu') : null;

    if (action === 'poll' || action === 'tail') {
      const cursorRaw = asOptionalNumber(argsObj.cursor, 'cursor');
      const offset =
        typeof cursorRaw === 'number' && Number.isFinite(cursorRaw)
          ? Math.floor(cursorRaw)
          : action === 'tail'
            ? -maxBytes
            : -maxBytes;

      const rpcParams: Record<string, unknown> = {
        offset,
        max_bytes: maxBytes,
      };

      const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
        request_json: { method: 'log.read', params: rpcParams },
        ...(timeoutMs ? { timeoutMs } : {}),
      });

      if (!resp.ok) return resp;

      const result =
        resp.details &&
        typeof resp.details === 'object' &&
        !Array.isArray(resp.details) &&
        (resp.details as Record<string, unknown>).result &&
        typeof (resp.details as Record<string, unknown>).result === 'object' &&
        !Array.isArray((resp.details as Record<string, unknown>).result)
          ? ((resp.details as Record<string, unknown>).result as Record<
              string,
              unknown
            >)
          : null;

      const lines = toLines(result?.lines);
      const nextOffset =
        typeof result?.next_offset === 'number'
          ? Math.floor(result.next_offset)
          : typeof result?.nextOffset === 'number'
            ? Math.floor(result.nextOffset)
            : null;
      const length =
        typeof result?.length === 'number' ? Math.floor(result.length) : null;

      const selected = onlyErrors
        ? filterErrorLike(lines, pattern).slice(0, maxMatches)
        : lines.slice(0, maxMatches);

      const parsedErrors = selected
        .map(parseGodotErrorLine)
        .filter((e): e is ParsedError => Boolean(e));

      if (openScriptOnError && parsedErrors.length > 0) {
        const first = parsedErrors.find((e) => e.file && e.line) ?? null;
        if (first?.file) {
          await callBaseTool(baseHandlers, 'godot_editor_view_manager', {
            action: 'edit_script',
            scriptPath: first.file,
            ...(typeof first.line === 'number'
              ? { lineNumber: first.line }
              : {}),
          });
        }
      }

      return {
        ok: true,
        summary:
          selected.length > 0
            ? 'godot_log_manager: log entries found'
            : 'godot_log_manager: no matching log entries',
        details: {
          source: 'editor_log',
          offset,
          nextOffset,
          length,
          maxBytes,
          onlyErrors,
          ...(rawPattern ? { pattern: rawPattern } : {}),
          lines: selected,
          parsedErrors,
        },
      };
    }

    return supportedActionError(
      'godot_log_manager',
      actionRaw,
      supportedActions,
    );
  };
}
