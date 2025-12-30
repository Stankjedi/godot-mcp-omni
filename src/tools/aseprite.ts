import { resolveInsideProject } from '../security.js';
import {
  asNonEmptyString,
  asOptionalNonEmptyString,
  asOptionalNumber,
  asRecord,
} from '../validation.js';

import {
  detectAsepriteCapabilities,
  getAsepriteStatus,
  runAseprite,
} from '../pipeline/aseprite_runner.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

export function createAsepriteToolHandlers(
  ctx: ServerContext,
): Record<string, ToolHandler> {
  return {
    aseprite_doctor: async (args: unknown): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const timeoutMs =
        asOptionalNumber(argsObj.timeoutMs, 'timeoutMs') ?? 10_000;

      const status = getAsepriteStatus();
      const ready = Boolean(
        status.externalToolsEnabled && status.resolvedExecutable,
      );

      const suggestions: string[] = [];
      if (!status.externalToolsEnabled)
        suggestions.push(
          'Set ALLOW_EXTERNAL_TOOLS=true to enable external tools.',
        );
      if (!status.resolvedExecutable) {
        suggestions.push(
          'Set ASEPRITE_PATH to your Aseprite install directory or executable path.',
        );
        suggestions.push(
          'Steam default (Windows): C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite',
        );
        suggestions.push(
          'WSL default: /mnt/c/Program Files (x86)/Steam/steamapps/common/Aseprite',
        );
      }

      const capabilities = ready
        ? await detectAsepriteCapabilities({ timeoutMs })
        : null;

      return {
        ok: ready,
        summary: ready
          ? 'Aseprite is available'
          : 'Aseprite is not available (disabled or not found)',
        details: {
          status,
          capabilities,
          suggestions: suggestions.length > 0 ? suggestions : undefined,
        },
        logs: capabilities
          ? [
              ...splitLines(capabilities.stdout),
              ...splitLines(capabilities.stderr).map((l) => `[stderr] ${l}`),
            ].slice(0, 200)
          : undefined,
      };
    },

    aseprite_export_spritesheet: async (
      args: unknown,
    ): Promise<ToolResponse> => {
      const argsObj = asRecord(args, 'args');
      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      const inputPath = asNonEmptyString(argsObj.inputPath, 'inputPath');
      const outputPngPath = asNonEmptyString(
        argsObj.outputPngPath,
        'outputPngPath',
      );
      const outputJsonPath = asOptionalNonEmptyString(
        argsObj.outputJsonPath,
        'outputJsonPath',
      );
      const timeoutMs =
        asOptionalNumber(argsObj.timeoutMs, 'timeoutMs') ?? 120_000;

      ctx.assertValidProject(projectPath);

      const absInput = resolveInsideProject(projectPath, inputPath);
      const absPng = resolveInsideProject(projectPath, outputPngPath);
      const absJson = outputJsonPath
        ? resolveInsideProject(projectPath, outputJsonPath)
        : null;

      const asepriteArgs: string[] = ['-b', absInput, '--sheet', absPng];
      if (absJson) {
        asepriteArgs.push('--data', absJson, '--format', 'json-array');
      }

      const result = await runAseprite(asepriteArgs, {
        cwd: projectPath,
        timeoutMs,
      });

      const logs = [
        ...splitLines(result.stdout),
        ...splitLines(result.stderr).map((l) => `[stderr] ${l}`),
      ].slice(0, 200);

      return {
        ok: result.ok,
        summary: result.ok ? 'Aseprite export completed' : result.summary,
        details: {
          inputPath,
          outputPngPath,
          outputJsonPath: outputJsonPath ?? null,
          command: result.command,
          args: result.args,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          attemptedCandidates: result.attemptedCandidates,
          capabilities: result.capabilities,
          suggestions: result.suggestions,
        },
        logs,
      };
    },
  };
}
