import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveInsideProject } from '../security.js';
import {
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalNumber,
  asOptionalRecord,
  asOptionalString,
  asRecord,
  ValidationError,
  valueType,
} from '../validation.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';

import {
  callBaseTool,
  hasEditorConnection,
  normalizeAction,
  supportedActionError,
  type BaseToolHandlers,
} from './unified/shared.js';

const SUPPORTED_ACTIONS = [
  'script.create',
  'script.read',
  'script.attach',
  'gdscript.eval_restricted',
  'shader.create',
  'shader.apply',
  'file.edit',
  'file.write_binary',
] as const;

type SupportedAction = (typeof SUPPORTED_ACTIONS)[number];

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.stat(absPath);
    return true;
  } catch {
    return false;
  }
}

async function safeWriteTextFile(options: {
  absPath: string;
  content: string;
  allowOverwrite: boolean;
}): Promise<{ wrote: boolean; bytes: number; changed: boolean }> {
  const { absPath, content, allowOverwrite } = options;
  const exists = await fileExists(absPath);
  if (exists) {
    const prev = await fs.readFile(absPath, 'utf8');
    if (prev === content) {
      return {
        wrote: false,
        bytes: Buffer.byteLength(content, 'utf8'),
        changed: false,
      };
    }
    if (!allowOverwrite) {
      throw new Error(
        'File exists and differs (set ALLOW_DANGEROUS_OPS=true to overwrite).',
      );
    }
  }

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, 'utf8');
  return {
    wrote: true,
    bytes: Buffer.byteLength(content, 'utf8'),
    changed: true,
  };
}

function defaultScriptTemplate(options: {
  className?: string | null;
  baseType?: string;
}): string {
  const className =
    typeof options.className === 'string' && options.className.trim()
      ? options.className.trim()
      : null;
  const baseType =
    typeof options.baseType === 'string' && options.baseType.trim()
      ? options.baseType.trim()
      : 'Node';

  const lines = [`extends ${baseType}`];
  if (className) lines.push(`class_name ${className}`);
  lines.push('');
  lines.push('func _ready() -> void:');
  lines.push('\tpass');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function defaultShaderTemplate(): string {
  return [
    'shader_type canvas_item;',
    '',
    'void fragment() {',
    '\tCOLOR = COLOR;',
    '}',
    '',
  ].join('\n');
}

function applyEdits(options: {
  text: string;
  find: string;
  replace: string;
  regex: boolean;
  maxReplacements: number;
}): { next: string; replacements: number } {
  const { text, find, replace, regex, maxReplacements } = options;
  if (maxReplacements <= 0) return { next: text, replacements: 0 };

  if (!regex) {
    let remaining = maxReplacements;
    let replacements = 0;
    let next = text;
    while (remaining > 0) {
      const idx = next.indexOf(find);
      if (idx === -1) break;
      next = `${next.slice(0, idx)}${replace}${next.slice(idx + find.length)}`;
      replacements += 1;
      remaining -= 1;
    }
    return { next, replacements };
  }

  const re = new RegExp(find, 'gu');
  let replacements = 0;
  const next = text.replace(re, (match) => {
    if (replacements >= maxReplacements) return match;
    replacements += 1;
    return replace;
  });
  return { next, replacements };
}

export function createCodeManagerToolHandlers(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
): Record<string, ToolHandler> {
  return {
    godot_code_manager: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw) as SupportedAction;

      if (!SUPPORTED_ACTIONS.includes(action)) {
        return supportedActionError('godot_code_manager', actionRaw, [
          ...SUPPORTED_ACTIONS,
        ]);
      }

      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);

      const allowOverwrite = process.env.ALLOW_DANGEROUS_OPS === 'true';

      if (action === 'script.create') {
        const scriptPath = asNonEmptyString(argsObj.scriptPath, 'scriptPath');
        const template =
          asOptionalString(argsObj.template, 'template')?.trim() ??
          'basic_node';
        const className = asOptionalString(argsObj.className, 'className');
        const contentRaw = asOptionalString(argsObj.content, 'content');

        const content =
          typeof contentRaw === 'string'
            ? contentRaw
            : template === 'basic_node'
              ? defaultScriptTemplate({ className, baseType: 'Node' })
              : defaultScriptTemplate({ className, baseType: 'Node' });

        const absPath = resolveInsideProject(projectPath, scriptPath);
        try {
          const write = await safeWriteTextFile({
            absPath,
            content,
            allowOverwrite,
          });
          return {
            ok: true,
            summary: write.changed
              ? 'script.create wrote file'
              : 'script.create (no change)',
            details: {
              projectPath,
              scriptPath,
              absolutePath: absPath,
              bytes: write.bytes,
              wrote: write.wrote,
              changed: write.changed,
            },
            logs: [],
          };
        } catch (error) {
          return {
            ok: false,
            summary: 'script.create failed',
            error: {
              code: 'E_PERMISSION_DENIED',
              message: String(error instanceof Error ? error.message : error),
              details: { scriptPath },
              retryable: true,
              suggestedFix:
                'Choose a new scriptPath or set ALLOW_DANGEROUS_OPS=true to overwrite existing files.',
            },
            details: { scriptPath },
            logs: [],
          };
        }
      }

      if (action === 'script.read') {
        const scriptPath = asNonEmptyString(argsObj.scriptPath, 'scriptPath');
        const absPath = resolveInsideProject(projectPath, scriptPath);
        if (!(await fileExists(absPath))) {
          return {
            ok: false,
            summary: 'script.read: file not found',
            error: {
              code: 'E_NOT_FOUND',
              message: 'File not found',
              details: { scriptPath },
              retryable: true,
              suggestedFix: 'Verify scriptPath and retry.',
            },
            details: { scriptPath },
            logs: [],
          };
        }
        const raw = await fs.readFile(absPath, 'utf8');
        const maxChars = Math.max(
          200,
          Math.min(
            200_000,
            Math.floor(
              asOptionalNumber(argsObj.maxChars, 'maxChars') ?? 12_000,
            ),
          ),
        );
        const truncated = raw.length > maxChars;
        const content = truncated
          ? `${raw.slice(0, maxChars)}\n\n[TRUNCATED]`
          : raw;
        return {
          ok: true,
          summary: truncated ? 'script.read ok (truncated)' : 'script.read ok',
          details: {
            projectPath,
            scriptPath,
            absolutePath: absPath,
            truncated,
            maxChars,
            content,
          },
          logs: [],
        };
      }

      if (action === 'script.attach') {
        const nodePath = asNonEmptyString(argsObj.nodePath, 'nodePath');
        const scriptPath = asNonEmptyString(argsObj.scriptPath, 'scriptPath');
        const scenePath = asOptionalString(argsObj.scenePath, 'scenePath');

        const resp = await callBaseTool(baseHandlers, 'godot_scene_manager', {
          action: 'attach_script',
          nodePath,
          scriptPath,
          ...(typeof scenePath === 'string' && scenePath.trim()
            ? { projectPath, scenePath: scenePath.trim() }
            : {}),
        });

        return {
          ok: resp.ok,
          summary: resp.ok ? 'script.attach completed' : 'script.attach failed',
          details: { response: resp },
          logs: resp.logs,
        };
      }

      if (action === 'gdscript.eval_restricted') {
        const expression =
          asOptionalString(
            (argsObj as Record<string, unknown>).expression,
            'expression',
          ) ??
          asOptionalString((argsObj as Record<string, unknown>).code, 'code');

        const trimmed = typeof expression === 'string' ? expression.trim() : '';
        if (!trimmed) {
          return {
            ok: false,
            summary: 'gdscript.eval_restricted requires expression (or code)',
            error: {
              code: 'E_SCHEMA_VALIDATION',
              message: 'gdscript.eval_restricted requires expression (or code)',
              details: { required: ['expression | code'] },
              retryable: true,
              suggestedFix: 'Provide expression (or code) and retry.',
            },
            details: { required: ['expression | code'] },
            logs: [],
          };
        }

        const vars =
          asOptionalRecord((argsObj as Record<string, unknown>).vars, 'vars') ??
          asOptionalRecord(
            (argsObj as Record<string, unknown>).variables,
            'variables',
          );

        if (hasEditorConnection(ctx)) {
          const resp = await callBaseTool(baseHandlers, 'godot_rpc', {
            request_json: {
              method: 'gdscript.eval_restricted',
              params: {
                expression: trimmed,
                ...(vars ? { vars } : {}),
              },
            },
          });

          return {
            ok: resp.ok,
            summary: resp.ok
              ? 'gdscript.eval_restricted ok'
              : 'gdscript.eval_restricted failed',
            details: { response: resp },
            logs: resp.logs,
          };
        }

        const resp = await callBaseTool(baseHandlers, 'godot_headless_op', {
          projectPath,
          operation: 'eval_expression',
          params: {
            expression: trimmed,
            ...(vars ? { vars } : {}),
          },
        });

        return {
          ok: resp.ok,
          summary: resp.ok
            ? 'gdscript.eval_restricted ok (headless)'
            : 'gdscript.eval_restricted failed (headless)',
          details: { response: resp },
          logs: resp.logs,
        };
      }

      if (action === 'shader.create') {
        const shaderPath = asNonEmptyString(argsObj.shaderPath, 'shaderPath');
        const contentRaw = asOptionalString(argsObj.content, 'content');
        const content =
          typeof contentRaw === 'string' ? contentRaw : defaultShaderTemplate();

        const absPath = resolveInsideProject(projectPath, shaderPath);
        try {
          const write = await safeWriteTextFile({
            absPath,
            content,
            allowOverwrite,
          });
          return {
            ok: true,
            summary: write.changed
              ? 'shader.create wrote file'
              : 'shader.create (no change)',
            details: {
              projectPath,
              shaderPath,
              absolutePath: absPath,
              bytes: write.bytes,
              wrote: write.wrote,
              changed: write.changed,
            },
            logs: [],
          };
        } catch (error) {
          return {
            ok: false,
            summary: 'shader.create failed',
            error: {
              code: 'E_PERMISSION_DENIED',
              message: String(error instanceof Error ? error.message : error),
              details: { shaderPath },
              retryable: true,
              suggestedFix:
                'Choose a new shaderPath or set ALLOW_DANGEROUS_OPS=true to overwrite existing files.',
            },
            details: { shaderPath },
            logs: [],
          };
        }
      }

      if (action === 'shader.apply') {
        const nodePath = asNonEmptyString(argsObj.nodePath, 'nodePath');
        const shaderPath = asNonEmptyString(argsObj.shaderPath, 'shaderPath');
        const materialProperty =
          asOptionalString(
            argsObj.materialProperty,
            'materialProperty',
          )?.trim() || 'material_override';

        const absShader = resolveInsideProject(projectPath, shaderPath);
        if (!(await fileExists(absShader))) {
          return {
            ok: false,
            summary: 'shader.apply: shader file not found',
            error: {
              code: 'E_NOT_FOUND',
              message: 'Shader file not found',
              details: { shaderPath },
              retryable: true,
              suggestedFix:
                'Call shader.create first (or verify shaderPath), then retry.',
            },
            details: { shaderPath },
            logs: [],
          };
        }

        const value = {
          $resource: 'ShaderMaterial',
          props: {
            shader: { $resource: 'Shader', path: shaderPath },
          },
        };

        const resp = await callBaseTool(
          baseHandlers,
          'godot_inspector_manager',
          {
            action: 'set_property',
            nodePath,
            property: materialProperty,
            value,
          },
        );

        return {
          ok: resp.ok,
          summary: resp.ok ? 'shader.apply completed' : 'shader.apply failed',
          details: { nodePath, shaderPath, materialProperty, response: resp },
          logs: resp.logs,
        };
      }

      if (action === 'file.edit') {
        const filePath = asNonEmptyString(argsObj.filePath, 'filePath');
        const find = asNonEmptyString(argsObj.find, 'find');
        const replace = asOptionalString(argsObj.replace, 'replace') ?? '';
        const regex = asOptionalBoolean(argsObj.regex, 'regex') ?? false;
        const dryRun = asOptionalBoolean(argsObj.dryRun, 'dryRun') ?? false;
        const maxReplacements = Math.max(
          1,
          Math.min(
            10_000,
            Math.floor(
              asOptionalNumber(argsObj.maxReplacements, 'maxReplacements') ??
                50,
            ),
          ),
        );

        const absPath = resolveInsideProject(projectPath, filePath);
        if (!(await fileExists(absPath))) {
          return {
            ok: false,
            summary: 'file.edit: file not found',
            error: {
              code: 'E_NOT_FOUND',
              message: 'File not found',
              details: { filePath },
              retryable: true,
              suggestedFix: 'Verify filePath and retry.',
            },
            details: { filePath },
            logs: [],
          };
        }

        const raw = await fs.readFile(absPath, 'utf8');
        let next: string;
        let replacements: number;
        try {
          const result = applyEdits({
            text: raw,
            find,
            replace,
            regex,
            maxReplacements,
          });
          next = result.next;
          replacements = result.replacements;
        } catch (error) {
          return {
            ok: false,
            summary: 'file.edit: invalid regex',
            error: {
              code: 'E_SCHEMA_VALIDATION',
              message: String(error instanceof Error ? error.message : error),
              details: { find, regex: true },
              retryable: true,
              suggestedFix: 'Provide a valid regex pattern or set regex=false.',
            },
            details: { find, regex: true },
            logs: [],
          };
        }

        const changed = next !== raw;
        const previewMax = 1200;
        const previewBefore = decodeHtmlEntities(raw.slice(0, previewMax));
        const previewAfter = decodeHtmlEntities(next.slice(0, previewMax));

        if (!dryRun && changed) {
          if (!allowOverwrite) {
            // This operation is always a change; treat as a file write.
            // Keep it permissive but safe: allow edits inside project without ALLOW_DANGEROUS_OPS.
          }
          await fs.writeFile(absPath, next, 'utf8');
        }

        return {
          ok: true,
          summary: dryRun
            ? 'file.edit dryRun completed'
            : 'file.edit completed',
          details: {
            projectPath,
            filePath,
            absolutePath: absPath,
            changed,
            replacements,
            dryRun,
            preview: { before: previewBefore, after: previewAfter },
          },
          logs: [],
        };
      }

      if (action === 'file.write_binary') {
        const filePath = asNonEmptyString(argsObj.filePath, 'filePath');
        const base64 = asNonEmptyString(argsObj.base64, 'base64');
        const absPath = resolveInsideProject(projectPath, filePath);

        let bytes: Uint8Array;
        try {
          bytes = Buffer.from(base64, 'base64');
        } catch (error) {
          return {
            ok: false,
            summary: 'file.write_binary: invalid base64 payload',
            error: {
              code: 'E_SCHEMA_VALIDATION',
              message: String(error instanceof Error ? error.message : error),
              details: { filePath },
              retryable: true,
              suggestedFix: 'Provide a valid base64 payload.',
            },
            details: { filePath },
            logs: [],
          };
        }

        const exists = await fileExists(absPath);
        if (exists && !allowOverwrite) {
          return {
            ok: false,
            summary: 'file.write_binary: file exists',
            error: {
              code: 'E_PERMISSION_DENIED',
              message: 'Refusing to overwrite an existing binary file',
              details: { filePath },
              retryable: true,
              suggestedFix:
                'Choose a new filePath or set ALLOW_DANGEROUS_OPS=true.',
            },
            details: { filePath },
            logs: [],
          };
        }

        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, bytes);

        return {
          ok: true,
          summary: 'file.write_binary wrote file',
          details: {
            projectPath,
            filePath,
            absolutePath: absPath,
            bytes: bytes.length,
          },
          logs: [],
        };
      }

      throw new ValidationError(
        'action',
        `Unhandled action: ${action}`,
        valueType(action),
      );
    },
  };
}
