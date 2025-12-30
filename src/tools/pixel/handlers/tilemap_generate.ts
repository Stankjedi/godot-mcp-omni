import fs from 'fs/promises';
import path from 'path';

import { resolveInsideProject } from '../../../security.js';
import {
  ValidationError,
  asNonEmptyString,
  asOptionalBoolean,
  asOptionalString,
  asRecord,
  valueType,
} from '../../../validation.js';

import { runAseprite } from '../../../pipeline/aseprite_runner.js';
import {
  createImageGenAdapter,
  ManualDropMissingFileError,
} from '../../../pipeline/image_gen_adapter.js';
import { generatePlaceholderTileSheetRgba } from '../../../pipeline/pixel_image.js';
import { writePngRgba } from '../../../pipeline/png.js';
import type {
  PixelManifestStep,
  PixelProjectProfile,
} from '../../../pipeline/pixel_types.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';
import type { BaseToolHandlers } from '../../unified/shared.js';

import { fileExists, readJsonIfExists } from '../files.js';
import { nowIso } from '../manifest.js';
import { normalizeResPath } from '../paths.js';
import { parseTilemapSpec, type TilemapGenerateOutputs } from '../spec.js';
import {
  requiredTileMappingFallback,
  tileAliases,
  tileMappingFromAsepriteJson,
} from '../tiles.js';

import {
  externalToolsAllowed,
  forceRegenerateBlocked,
  overwriteAllowed,
  requireToolHandler,
  analyzePixelProjectForTool,
} from './shared.js';

export async function runTilemapGenerate(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  argsObj: Record<string, unknown>,
): Promise<{
  response: ToolResponse;
  outputs?: TilemapGenerateOutputs;
  step: PixelManifestStep;
  profile: PixelProjectProfile;
}> {
  const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
  const spec = asRecord(argsObj.spec, 'spec');
  const forceRegenerate =
    asOptionalBoolean(argsObj.forceRegenerate, 'forceRegenerate') ?? false;
  const reuseExistingSheet =
    asOptionalBoolean(argsObj.reuseExistingSheet, 'reuseExistingSheet') ??
    false;
  const allowExternalTools =
    asOptionalBoolean(argsObj.allowExternalTools, 'allowExternalTools') ??
    false;
  const imageGenModeRaw = asOptionalString(
    argsObj.imageGenMode,
    'imageGenMode',
  )?.trim();
  const imageGenMode =
    imageGenModeRaw && imageGenModeRaw.length > 0 ? imageGenModeRaw : 'auto';
  if (imageGenMode !== 'auto' && imageGenMode !== 'manual_drop') {
    throw new ValidationError(
      'imageGenMode',
      'Invalid field "imageGenMode": expected "auto" or "manual_drop"',
      valueType(argsObj.imageGenMode),
    );
  }

  const startedAt = nowIso();
  const profile = await analyzePixelProjectForTool(ctx, projectPath);
  const parsed = parseTilemapSpec(spec, profile.pixel.tileSize || 16);

  const sourceAsepritePathRaw = asOptionalString(
    (spec as Record<string, unknown>).sourceAsepritePath ??
      (spec as Record<string, unknown>).source_aseprite_path,
    'spec.sourceAsepritePath',
  )?.trim();
  const sourceAsepritePath = sourceAsepritePathRaw
    ? normalizeResPath(sourceAsepritePathRaw)
    : undefined;

  if (!overwriteAllowed(forceRegenerate)) {
    const response = forceRegenerateBlocked('pixel_tilemap_generate');
    return {
      response,
      step: {
        name: 'pixel_tilemap_generate',
        startedAt,
        finishedAt: nowIso(),
        ok: false,
        summary: response.summary,
        details: response.details,
      },
      profile,
    };
  }

  const output = parsed.output;

  const absPng = resolveInsideProject(projectPath, output.sheetPngPath);
  const absTres = resolveInsideProject(projectPath, output.tilesetPath);
  const absMeta = resolveInsideProject(projectPath, output.metaJsonPath);
  const absAsepriteJson = output.asepriteJsonPath
    ? resolveInsideProject(projectPath, output.asepriteJsonPath)
    : null;

  const pngExists = await fileExists(absPng);
  const tresExists = await fileExists(absTres);
  const metaExists = await fileExists(absMeta);
  const asepriteJsonExists = absAsepriteJson
    ? await fileExists(absAsepriteJson)
    : false;
  const existing = [
    ...(pngExists ? [output.sheetPngPath] : []),
    ...(tresExists ? [output.tilesetPath] : []),
    ...(metaExists ? [output.metaJsonPath] : []),
    ...(asepriteJsonExists && output.asepriteJsonPath
      ? [output.asepriteJsonPath]
      : []),
  ];

  if (tresExists && !forceRegenerate) {
    const response: ToolResponse = {
      ok: true,
      summary: 'TileSet already exists (skipping)',
      details: {
        output,
        existing,
        reused: { sheetPng: pngExists, metaJson: metaExists, tileset: true },
        suggestions: [
          'Set forceRegenerate=true to overwrite (requires ALLOW_DANGEROUS_OPS=true).',
        ],
      },
    };
    return {
      response,
      outputs: output,
      step: {
        name: 'pixel_tilemap_generate',
        startedAt,
        finishedAt: nowIso(),
        ok: true,
        summary: response.summary,
        details: response.details,
      },
      profile,
    };
  }

  const allowExistingSheet =
    reuseExistingSheet || imageGenMode === 'manual_drop';
  if (existing.length > 0 && !forceRegenerate && !allowExistingSheet) {
    const response: ToolResponse = {
      ok: false,
      summary:
        'Tilemap outputs already exist (use forceRegenerate to overwrite)',
      details: {
        existing,
        suggestions: [
          'Set forceRegenerate=true to overwrite (requires ALLOW_DANGEROUS_OPS=true).',
          'Or set reuseExistingSheet=true to reuse an existing sheet PNG while generating the TileSet.',
          'Or set imageGenMode="manual_drop" to require the sheet PNG to already exist (no placeholder generation).',
        ],
      },
    };
    return {
      response,
      step: {
        name: 'pixel_tilemap_generate',
        startedAt,
        finishedAt: nowIso(),
        ok: false,
        summary: response.summary,
        details: response.details,
      },
      profile,
    };
  }

  const width = output.sheet.columns * output.tileSize;
  const height = output.sheet.rows * output.tileSize;

  const reusedSheet = pngExists && !forceRegenerate;
  let asepriteExport: Record<string, unknown> | null = null;
  let derivedTileMapping: Record<string, { x: number; y: number }> | null =
    null;

  if (sourceAsepritePath) {
    if (!externalToolsAllowed(allowExternalTools)) {
      const response: ToolResponse = {
        ok: false,
        summary:
          'Aseprite source provided but external tools are not enabled (ALLOW_EXTERNAL_TOOLS!=true)',
        details: {
          sourceAsepritePath,
          suggestions: [
            'Set allowExternalTools=true and ALLOW_EXTERNAL_TOOLS=true to enable Aseprite export.',
            'Or omit spec.sourceAsepritePath to use the builtin placeholder tilesheet generator.',
          ],
        },
      };
      return {
        response,
        step: {
          name: 'pixel_tilemap_generate',
          startedAt,
          finishedAt: nowIso(),
          ok: false,
          summary: response.summary,
          details: response.details,
        },
        profile,
      };
    }

    // If the PNG already exists and we aren't forcing, treat it as reused (idempotent).
    if (!reusedSheet) {
      const absInput = resolveInsideProject(projectPath, sourceAsepritePath);
      await fs.mkdir(path.dirname(absPng), { recursive: true });
      if (absAsepriteJson)
        await fs.mkdir(path.dirname(absAsepriteJson), { recursive: true });

      const baseArgs: string[] = ['-b', absInput, '--sheet', absPng];
      if (absAsepriteJson) {
        baseArgs.push('--data', absAsepriteJson, '--format', 'json-array');
      }

      const extraListFlags = ['--list-slices', '--list-tags', '--list-layers'];
      let exportResult = await runAseprite([...baseArgs, ...extraListFlags], {
        cwd: projectPath,
        timeoutMs: 120_000,
      });

      if (!exportResult.ok) {
        const stderrLower = exportResult.stderr.toLowerCase();
        const looksUnsupportedFlag =
          stderrLower.includes('unknown option') ||
          stderrLower.includes('unrecognized option') ||
          stderrLower.includes('unknown argument') ||
          stderrLower.includes('unknown parameter');
        if (looksUnsupportedFlag) {
          exportResult = await runAseprite(baseArgs, {
            cwd: projectPath,
            timeoutMs: 120_000,
          });
        }
      }

      asepriteExport = {
        ok: exportResult.ok,
        summary: exportResult.summary,
        command: exportResult.command,
        args: exportResult.args,
        exitCode: exportResult.exitCode,
        durationMs: exportResult.durationMs,
        attemptedCandidates: exportResult.attemptedCandidates,
        capabilities: exportResult.capabilities,
        suggestions: exportResult.suggestions,
      };

      if (!exportResult.ok) {
        const response: ToolResponse = {
          ok: false,
          summary: exportResult.summary,
          details: {
            sourceAsepritePath,
            export: asepriteExport,
            suggestions: [
              ...(exportResult.suggestions ?? []),
              'Run aseprite_doctor to check detection and supported flags.',
            ],
          },
        };
        return {
          response,
          step: {
            name: 'pixel_tilemap_generate',
            startedAt,
            finishedAt: nowIso(),
            ok: false,
            summary: response.summary,
            details: response.details,
          },
          profile,
        };
      }

      // Best-effort: derive mapping from slices if the JSON exists.
      if (absAsepriteJson) {
        const asepriteJson = await readJsonIfExists(absAsepriteJson);
        derivedTileMapping = tileMappingFromAsepriteJson(
          asepriteJson,
          output.tileSize,
        );
      }
    }
  } else if (!reusedSheet) {
    const prompt = [
      `Generate a pixel-art tileset atlas PNG.`,
      `Theme: ${output.theme ?? parsed.theme ?? 'auto'}.`,
      `Tile size: ${output.tileSize}px.`,
      `Grid: ${output.sheet.columns}x${output.sheet.rows}.`,
      `Required tiles at row 0: grass(0,0), forest(1,0), water(2,0), path(3,0), cliff(4,0).`,
    ].join(' ');

    if (imageGenMode === 'manual_drop') {
      const adapter = createImageGenAdapter({
        allowExternalTools: false,
        mode: 'manual_drop',
      });
      try {
        await adapter.generateImage(prompt, {
          width,
          height,
          seed: 1337,
          outputPath: absPng,
        });
      } catch (error) {
        const response: ToolResponse = {
          ok: false,
          summary: 'ManualDrop tilesheet PNG is missing',
          details: {
            adapter: adapter.name,
            requiredFiles: [output.sheetPngPath],
            expectedSizePx: { width, height },
            expectedTileSizePx: output.tileSize,
            expectedGrid: {
              columns: output.sheet.columns,
              rows: output.sheet.rows,
            },
            error:
              error instanceof ManualDropMissingFileError
                ? error.message
                : String(error),
            suggestions: [
              `Add a PNG at ${output.sheetPngPath} (expected size: ${width}x${height}).`,
              'Re-run pixel_tilemap_generate with the same spec once the file exists.',
              'Or omit imageGenMode/manual_drop to use the builtin placeholder generator.',
            ],
          },
        };
        return {
          response,
          step: {
            name: 'pixel_tilemap_generate',
            startedAt,
            finishedAt: nowIso(),
            ok: false,
            summary: response.summary,
            details: response.details,
          },
          profile,
        };
      }
    } else if (
      externalToolsAllowed(allowExternalTools) &&
      (process.env.IMAGE_GEN_URL ?? '').trim().length > 0
    ) {
      const adapter = createImageGenAdapter({ allowExternalTools: true });
      try {
        await adapter.generateImage(prompt, {
          width,
          height,
          seed: 1337,
          outputPath: absPng,
        });
      } catch (error) {
        const response: ToolResponse = {
          ok: false,
          summary: `External image generation failed: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            adapter: adapter.name,
            suggestions: [
              'Disable allowExternalTools to use the builtin placeholder generator.',
              'Verify IMAGE_GEN_URL points to a service that returns a PNG body.',
            ],
          },
        };
        return {
          response,
          step: {
            name: 'pixel_tilemap_generate',
            startedAt,
            finishedAt: nowIso(),
            ok: false,
            summary: response.summary,
            details: response.details,
          },
          profile,
        };
      }
    } else {
      const gen = generatePlaceholderTileSheetRgba({
        tileSize: output.tileSize,
        columns: output.sheet.columns,
        rows: output.sheet.rows,
        seed: 1337,
      });
      await writePngRgba(absPng, gen.width, gen.height, gen.rgba);
    }
  }

  // Always write a meta mapping (assumes the required tiles are in fixed atlas coords).
  const reusedMeta = metaExists && !forceRegenerate;
  if (!reusedMeta) {
    const mapping = derivedTileMapping ?? requiredTileMappingFallback();
    const aliases = tileAliases();
    const meta = {
      schemaVersion: 1,
      tileSize: output.tileSize,
      sheet: { columns: output.sheet.columns, rows: output.sheet.rows },
      tiles: Object.fromEntries(
        Object.entries(mapping).map(([k, v]) => [
          k,
          { atlas: v, ...(aliases[k] ? { aliases: aliases[k] } : {}) },
        ]),
      ),
      source: {
        generator: sourceAsepritePath
          ? 'aseprite'
          : imageGenMode === 'manual_drop'
            ? 'manual_drop'
            : externalToolsAllowed(allowExternalTools) &&
                (process.env.IMAGE_GEN_URL ?? '').trim().length > 0
              ? 'external_http'
              : 'builtin_placeholder',
        ...(sourceAsepritePath ? { asepritePath: sourceAsepritePath } : {}),
      },
    };
    await fs.mkdir(path.dirname(absMeta), { recursive: true });
    await fs.writeFile(absMeta, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }

  // Create TileSet via headless op.
  const headlessOp = requireToolHandler(baseHandlers, 'godot_headless_op');
  const createTilesetResp = await headlessOp({
    projectPath,
    operation: 'op_tileset_create_from_atlas',
    params: {
      pngPath: output.sheetPngPath,
      tileSize: output.tileSize,
      outputTilesetPath: output.tilesetPath,
      allowOverwrite: forceRegenerate,
    },
  });

  const step: PixelManifestStep = {
    name: 'pixel_tilemap_generate',
    startedAt,
    finishedAt: nowIso(),
    ok: Boolean(createTilesetResp.ok),
    summary: createTilesetResp.summary,
    details: {
      ...(createTilesetResp.details ?? {}),
      cacheKey: createTilesetResp.details?.cacheKey,
    },
  };

  return createTilesetResp.ok
    ? {
        response: {
          ok: true,
          summary: 'Tilemap generated',
          details: {
            output,
            reused: {
              sheetPng: reusedSheet,
              metaJson: reusedMeta,
              tileset: false,
            },
            op: createTilesetResp,
          },
        },
        outputs: output,
        step,
        profile,
      }
    : { response: createTilesetResp, step, profile };
}
