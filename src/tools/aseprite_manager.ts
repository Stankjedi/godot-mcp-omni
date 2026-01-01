import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Dirent } from 'fs';

import {
  absPathToResPath,
  ensureAPrefix,
  numberToFilenameToken,
  resolvePathLikeInsideProject,
  sanitizeFileComponent,
} from '../pipeline/aseprite_manager_utils.js';
import { getAsepriteStatus, runAseprite } from '../pipeline/aseprite_runner.js';
import {
  asNonEmptyString,
  asNonNegativeInteger,
  asNumber,
  asOptionalBoolean,
  asOptionalNonEmptyString,
  asOptionalNumber,
  asOptionalRecord,
  asRecord,
  ValidationError,
} from '../validation.js';

import type { ServerContext } from './context.js';
import type { ToolHandler, ToolResponse } from './types.js';
import {
  callBaseTool,
  normalizeAction,
  type BaseToolHandlers,
} from './unified/shared.js';

function nowIso(): string {
  return new Date().toISOString();
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

function asOptionalStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new ValidationError(fieldName, 'Expected array', typeof value);
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

type CommonRunOptions = {
  preview: boolean;
  verbose: boolean;
  timeoutMs: number;
};

type AsepriteManagerDeps = {
  getAsepriteStatus: typeof getAsepriteStatus;
  runAseprite: typeof runAseprite;
};

function parseCommonRunOptions(
  argsObj: Record<string, unknown>,
): CommonRunOptions {
  const optionsObj = asOptionalRecord(argsObj.options, 'options') ?? {};
  const preview =
    asOptionalBoolean(optionsObj.preview, 'options.preview') ?? false;
  const verbose =
    asOptionalBoolean(optionsObj.verbose, 'options.verbose') ?? false;
  const timeoutMs =
    asOptionalNumber(optionsObj.timeoutMs, 'options.timeoutMs') ?? 60_000;
  return { preview, verbose, timeoutMs };
}

type OutputSpec = {
  projectRootAbs: string;
  outputDirAbs: string;
  outputDirRes: string;
  baseName: string;
  overwrite: boolean;
};

function assertNoPathSeparators(value: string, fieldName: string): void {
  if (/[\\/]/u.test(value)) {
    throw new ValidationError(
      fieldName,
      `Invalid field "${fieldName}": must not contain path separators`,
      typeof value,
    );
  }
}

function parseOutputSpec(
  projectPath: string,
  projectRootAbs: string,
  argsObj: Record<string, unknown>,
  inputAbs: string,
  preview: boolean,
): OutputSpec {
  const outputObj = asOptionalRecord(argsObj.output, 'output') ?? {};
  const outputDirRaw =
    asOptionalNonEmptyString(outputObj.outputDir, 'output.outputDir') ??
    'res://art/export';
  const overwrite =
    asOptionalBoolean(outputObj.overwrite, 'output.overwrite') ?? false;

  const outputDirResolved = resolvePathLikeInsideProject(
    projectPath,
    outputDirRaw,
    {
      allowMissing: true,
    },
  );
  const outputDirAbs = outputDirResolved.absPath;
  const outputDirRes = outputDirResolved.resPath;

  if (!fs.existsSync(outputDirAbs)) {
    if (preview) {
      throw new Error(
        `Output directory does not exist in preview mode: ${outputDirRaw}`,
      );
    }
    fs.mkdirSync(outputDirAbs, { recursive: true });
  }

  const baseNameRaw = asOptionalNonEmptyString(
    outputObj.baseName,
    'output.baseName',
  );
  const derived = baseNameRaw ?? path.parse(inputAbs).name;
  assertNoPathSeparators(derived, 'output.baseName');

  const sanitized = sanitizeFileComponent(derived);
  const baseName = ensureAPrefix(sanitized);

  const resCheck = absPathToResPath(projectRootAbs, outputDirAbs);
  if (!resCheck) {
    throw new Error(`Output directory escapes project root: ${outputDirRaw}`);
  }

  return { projectRootAbs, outputDirAbs, outputDirRes, baseName, overwrite };
}

function precheckOverwrite(
  overwrite: boolean,
  outputFiles: Array<{ kind: string; absPath: string }>,
): ToolResponse | null {
  if (overwrite) return null;
  const collisions = outputFiles.filter((f) => fs.existsSync(f.absPath));
  if (collisions.length === 0) return null;
  return {
    ok: false,
    summary: 'Output file already exists (overwrite=false)',
    errors: collisions.map((c) => ({
      code: 'E_OUTPUT_EXISTS',
      message: `Refusing to overwrite existing file: ${c.absPath}`,
      details: { kind: c.kind, pathAbs: c.absPath },
    })),
  };
}

function precheckOverwriteByPrefix(
  overwrite: boolean,
  outputDirAbs: string,
  prefix: string,
): ToolResponse | null {
  if (overwrite) return null;

  let entries: Dirent[] = [];
  try {
    entries = fs.readdirSync(outputDirAbs, { withFileTypes: true });
  } catch {
    return null;
  }

  const matches: string[] = [];
  for (const dirent of entries) {
    const name = dirent.name;
    if (!name.startsWith(prefix)) continue;
    if (!dirent.isFile() && !dirent.isSymbolicLink()) continue;
    matches.push(path.join(outputDirAbs, name));
    if (matches.length >= 20) break;
  }

  if (matches.length === 0) return null;

  return {
    ok: false,
    summary: 'Output files already exist (overwrite=false)',
    errors: matches.map((p) => ({
      code: 'E_OUTPUT_EXISTS',
      message: `Refusing to overwrite existing file: ${p}`,
      details: { pathAbs: p, prefix },
    })),
  };
}

function fileEntry(
  projectRootAbs: string,
  kind: string,
  absPath: string,
  preview: boolean,
): { kind: string; pathAbs: string; resPath: string | null; bytes: number } {
  const resPath = absPathToResPath(projectRootAbs, absPath);
  const bytes =
    !preview && fs.existsSync(absPath) ? fs.statSync(absPath).size : 0;
  return { kind, pathAbs: absPath, resPath, bytes };
}

function collectFilesByPrefix(
  projectRootAbs: string,
  outputDirAbs: string,
  prefix: string,
  preview: boolean,
  opts: { imageKind?: string } = {},
): Array<{
  kind: string;
  pathAbs: string;
  resPath: string | null;
  bytes: number;
}> {
  if (preview) return [];
  let entries: Dirent[] = [];
  try {
    entries = fs.readdirSync(outputDirAbs, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: Array<{
    kind: string;
    pathAbs: string;
    resPath: string | null;
    bytes: number;
  }> = [];
  for (const dirent of entries) {
    const name = dirent.name;
    if (!name.startsWith(prefix)) continue;
    const absPath = path.join(outputDirAbs, name);
    let bytes: number;
    if (dirent.isFile()) {
      try {
        bytes = fs.statSync(absPath).size;
      } catch {
        continue;
      }
    } else if (dirent.isSymbolicLink()) {
      try {
        const st = fs.statSync(absPath);
        if (!st.isFile()) continue;
        bytes = st.size;
      } catch {
        continue;
      }
    } else {
      continue;
    }

    const ext = path.extname(name).toLowerCase();
    const isImage = ext === '.png' || ext === '.gif' || ext === '.webp';
    const kind =
      ext === '.json'
        ? 'sheet_data'
        : isImage
          ? (opts.imageKind ??
            (name.includes('__frame_') ? 'frame_image' : 'sprite_image'))
          : 'log';
    out.push({
      kind,
      pathAbs: absPath,
      resPath: absPathToResPath(projectRootAbs, absPath),
      bytes,
    });
    if (out.length >= 200) break;
  }
  return out;
}

type SheetSpec = {
  sheetType: string;
  format: 'json-hash' | 'json-array';
  sheetPack: boolean;
  sheetWidth?: number;
  sheetHeight?: number;
  sheetColumns?: number;
  sheetRows?: number;
  tag?: string;
  frameRange?: { from: number; to: number };
  ignoreEmpty: boolean;
  borderPadding?: number;
  shapePadding?: number;
  innerPadding?: number;
  trim: boolean;
  extrude: boolean;
  includeMeta?: {
    layers?: boolean;
    layerHierarchy?: boolean;
    tags?: boolean;
    slices?: boolean;
  };
  dataToStdout: boolean;
};

function parseSheetSpec(argsObj: Record<string, unknown>): SheetSpec {
  const sheetObj = asRecord(argsObj.sheet, 'sheet');
  const sheetType = asNonEmptyString(sheetObj.sheetType, 'sheet.sheetType');
  const format =
    (asOptionalNonEmptyString(sheetObj.format, 'sheet.format') as
      | 'json-hash'
      | 'json-array'
      | undefined) ?? 'json-hash';
  const sheetPack =
    asOptionalBoolean(sheetObj.sheetPack, 'sheet.sheetPack') ?? true;

  const sheetWidth = asOptionalNumber(sheetObj.sheetWidth, 'sheet.sheetWidth');
  const sheetHeight = asOptionalNumber(
    sheetObj.sheetHeight,
    'sheet.sheetHeight',
  );
  const sheetColumns = asOptionalNumber(
    sheetObj.sheetColumns,
    'sheet.sheetColumns',
  );
  const sheetRows = asOptionalNumber(sheetObj.sheetRows, 'sheet.sheetRows');

  const tag = asOptionalNonEmptyString(sheetObj.tag, 'sheet.tag');
  const frameRangeObj = asOptionalRecord(
    sheetObj.frameRange,
    'sheet.frameRange',
  );
  const frameRange = frameRangeObj
    ? {
        from: asNonNegativeInteger(frameRangeObj.from, 'sheet.frameRange.from'),
        to: asNonNegativeInteger(frameRangeObj.to, 'sheet.frameRange.to'),
      }
    : undefined;

  const ignoreEmpty =
    asOptionalBoolean(sheetObj.ignoreEmpty, 'sheet.ignoreEmpty') ?? false;
  const borderPadding = asOptionalNumber(
    sheetObj.borderPadding,
    'sheet.borderPadding',
  );
  const shapePadding = asOptionalNumber(
    sheetObj.shapePadding,
    'sheet.shapePadding',
  );
  const innerPadding = asOptionalNumber(
    sheetObj.innerPadding,
    'sheet.innerPadding',
  );
  const trim = asOptionalBoolean(sheetObj.trim, 'sheet.trim') ?? false;
  const extrude = asOptionalBoolean(sheetObj.extrude, 'sheet.extrude') ?? false;

  const includeMetaObj = asOptionalRecord(
    sheetObj.includeMeta,
    'sheet.includeMeta',
  );
  const includeMeta = includeMetaObj
    ? {
        layers: asOptionalBoolean(
          includeMetaObj.layers,
          'sheet.includeMeta.layers',
        ),
        layerHierarchy: asOptionalBoolean(
          includeMetaObj.layerHierarchy,
          'sheet.includeMeta.layerHierarchy',
        ),
        tags: asOptionalBoolean(includeMetaObj.tags, 'sheet.includeMeta.tags'),
        slices: asOptionalBoolean(
          includeMetaObj.slices,
          'sheet.includeMeta.slices',
        ),
      }
    : undefined;

  const dataToStdout =
    asOptionalBoolean(sheetObj.dataToStdout, 'sheet.dataToStdout') ?? false;

  return {
    sheetType,
    format,
    sheetPack,
    sheetWidth:
      sheetWidth === undefined
        ? undefined
        : asNumber(sheetWidth, 'sheet.sheetWidth'),
    sheetHeight:
      sheetHeight === undefined
        ? undefined
        : asNumber(sheetHeight, 'sheet.sheetHeight'),
    sheetColumns:
      sheetColumns === undefined
        ? undefined
        : asNumber(sheetColumns, 'sheet.sheetColumns'),
    sheetRows:
      sheetRows === undefined
        ? undefined
        : asNumber(sheetRows, 'sheet.sheetRows'),
    tag: tag ?? undefined,
    frameRange,
    ignoreEmpty,
    borderPadding:
      borderPadding === undefined
        ? undefined
        : asNumber(borderPadding, 'sheet.borderPadding'),
    shapePadding:
      shapePadding === undefined
        ? undefined
        : asNumber(shapePadding, 'sheet.shapePadding'),
    innerPadding:
      innerPadding === undefined
        ? undefined
        : asNumber(innerPadding, 'sheet.innerPadding'),
    trim,
    extrude,
    includeMeta,
    dataToStdout,
  };
}

function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  const candidate = text.slice(start, end + 1).trim();
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

async function runExportSheet(
  ctx: ServerContext,
  projectPath: string,
  inputFile: string,
  output: OutputSpec,
  sheet: SheetSpec,
  options: CommonRunOptions,
  runAsepriteFn: AsepriteManagerDeps['runAseprite'],
  overrides: { tagSuffix?: string; tagValue?: string } = {},
): Promise<{
  ok: boolean;
  summary: string;
  errors?: ToolResponse['errors'];
  outputBaseName: string;
  tag: string | null;
  dataReturnedViaStdout: boolean;
  dataJson: unknown | null;
  execution: ToolResponse['execution'];
  files: ToolResponse['files'];
}> {
  ctx.assertValidProject(projectPath);

  const inputResolved = resolvePathLikeInsideProject(projectPath, inputFile);
  const absInput = inputResolved.absPath;

  const tagValue = overrides.tagValue ?? sheet.tag ?? null;
  const tagSuffix =
    overrides.tagSuffix ??
    (tagValue ? `__tag_${sanitizeFileComponent(tagValue)}` : '');

  const outputBaseName = `${output.baseName}${tagSuffix}`;
  const sheetAbs = path.join(output.outputDirAbs, `${outputBaseName}.png`);
  const dataAbs = sheet.dataToStdout
    ? null
    : path.join(output.outputDirAbs, `${outputBaseName}.json`);

  const precheck = precheckOverwrite(output.overwrite, [
    { kind: 'sheet_image', absPath: sheetAbs },
    ...(dataAbs ? [{ kind: 'sheet_data', absPath: dataAbs }] : []),
  ]);
  if (precheck) {
    return {
      ok: false,
      summary: precheck.summary,
      errors: precheck.errors,
      outputBaseName,
      tag: tagValue,
      dataReturnedViaStdout: sheet.dataToStdout,
      dataJson: null,
      execution: undefined,
      files: undefined,
    };
  }

  const argv: string[] = ['-b'];
  if (options.preview) argv.push('--preview');
  if (options.verbose) argv.push('--verbose');

  if (tagValue) argv.push('--tag', tagValue);
  if (sheet.frameRange) {
    argv.push(
      '--frame-range',
      `${sheet.frameRange.from},${sheet.frameRange.to}`,
    );
  }
  if (sheet.ignoreEmpty) argv.push('--ignore-empty');
  if (sheet.trim) argv.push('--trim');
  if (sheet.extrude) argv.push('--extrude');

  argv.push(absInput);

  argv.push('--sheet-type', sheet.sheetType);
  if (sheet.sheetPack) argv.push('--sheet-pack');
  if (sheet.borderPadding !== undefined)
    argv.push('--border-padding', String(sheet.borderPadding));
  if (sheet.shapePadding !== undefined)
    argv.push('--shape-padding', String(sheet.shapePadding));
  if (sheet.innerPadding !== undefined)
    argv.push('--inner-padding', String(sheet.innerPadding));
  if (sheet.sheetWidth !== undefined)
    argv.push('--sheet-width', String(sheet.sheetWidth));
  if (sheet.sheetHeight !== undefined)
    argv.push('--sheet-height', String(sheet.sheetHeight));
  if (sheet.sheetColumns !== undefined)
    argv.push('--sheet-columns', String(sheet.sheetColumns));
  if (sheet.sheetRows !== undefined)
    argv.push('--sheet-rows', String(sheet.sheetRows));

  argv.push('--sheet', sheetAbs);

  if (sheet.dataToStdout) {
    argv.push('--data=');
  } else if (dataAbs) {
    argv.push('--data', dataAbs);
  }
  argv.push('--format', sheet.format);

  const extraListFlags: string[] = [];
  if (sheet.includeMeta?.layerHierarchy) {
    extraListFlags.push('--list-layer-hierarchy');
  } else if (sheet.includeMeta?.layers) {
    extraListFlags.push('--list-layers');
  }
  if (sheet.includeMeta?.tags) extraListFlags.push('--list-tags');
  if (sheet.includeMeta?.slices) extraListFlags.push('--list-slices');
  argv.push(...extraListFlags);

  const result = await runAsepriteFn(argv, {
    cwd: projectPath,
    timeoutMs: options.timeoutMs,
  });

  const execution: ToolResponse['execution'] = {
    asepritePath: result.command,
    cwd: projectPath,
    argv: [result.command, ...result.args],
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    preview: options.preview,
  };

  const files: ToolResponse['files'] = [
    fileEntry(output.projectRootAbs, 'sheet_image', sheetAbs, options.preview),
    ...(dataAbs
      ? [
          fileEntry(
            inputResolved.projectRootAbs,
            'sheet_data',
            dataAbs,
            options.preview,
          ),
        ]
      : []),
  ];

  const dataJson =
    sheet.dataToStdout && result.ok ? extractJsonObject(result.stdout) : null;

  return {
    ok: result.ok && (!sheet.dataToStdout || dataJson !== null),
    summary: result.ok
      ? sheet.dataToStdout && dataJson === null
        ? 'Aseprite export succeeded but JSON could not be parsed from stdout'
        : 'Aseprite export completed'
      : result.summary,
    errors:
      result.ok && sheet.dataToStdout && dataJson === null
        ? [
            {
              code: 'E_JSON_PARSE',
              message:
                'Failed to parse JSON from Aseprite stdout (consider disabling dataToStdout or includeMeta list flags).',
            },
          ]
        : undefined,
    outputBaseName,
    tag: tagValue,
    dataReturnedViaStdout: sheet.dataToStdout,
    dataJson,
    execution,
    files,
  };
}

type SpriteExportSpec = {
  format: 'png' | 'gif' | 'webp';
  mode: 'single' | 'frames';
  oneFrame: boolean;
  tag?: string;
  frameRange?: { from: number; to: number };
  ignoreEmpty: boolean;
  trim: boolean;
  crop?: { x: number; y: number; w: number; h: number };
  slice?: string;
  allLayers: boolean;
  layers: string[];
  ignoreLayers: string[];
};

function parseSpriteExportSpec(
  argsObj: Record<string, unknown>,
): SpriteExportSpec {
  const exportObj = asRecord(argsObj.export, 'export');
  const format =
    (asOptionalNonEmptyString(exportObj.format, 'export.format') as
      | 'png'
      | 'gif'
      | 'webp'
      | undefined) ?? 'png';
  const mode =
    (asOptionalNonEmptyString(exportObj.mode, 'export.mode') as
      | 'single'
      | 'frames'
      | undefined) ?? 'frames';
  const oneFrame =
    asOptionalBoolean(exportObj.oneFrame, 'export.oneFrame') ?? false;

  const tag =
    asOptionalNonEmptyString(exportObj.tag, 'export.tag') ?? undefined;
  const frameRangeObj = asOptionalRecord(
    exportObj.frameRange,
    'export.frameRange',
  );
  const frameRange = frameRangeObj
    ? {
        from: asNonNegativeInteger(
          frameRangeObj.from,
          'export.frameRange.from',
        ),
        to: asNonNegativeInteger(frameRangeObj.to, 'export.frameRange.to'),
      }
    : undefined;

  const ignoreEmpty =
    asOptionalBoolean(exportObj.ignoreEmpty, 'export.ignoreEmpty') ?? false;
  const trim = asOptionalBoolean(exportObj.trim, 'export.trim') ?? false;
  const cropObj = asOptionalRecord(exportObj.crop, 'export.crop');
  const crop = cropObj
    ? {
        x: asNonNegativeInteger(cropObj.x, 'export.crop.x'),
        y: asNonNegativeInteger(cropObj.y, 'export.crop.y'),
        w: asNonNegativeInteger(cropObj.w, 'export.crop.w'),
        h: asNonNegativeInteger(cropObj.h, 'export.crop.h'),
      }
    : undefined;
  const slice =
    asOptionalNonEmptyString(exportObj.slice, 'export.slice') ?? undefined;

  const allLayers =
    asOptionalBoolean(exportObj.allLayers, 'export.allLayers') ?? false;
  const layers = asOptionalStringArray(exportObj.layers, 'export.layers');
  const ignoreLayers = asOptionalStringArray(
    exportObj.ignoreLayers,
    'export.ignoreLayers',
  );

  return {
    format,
    mode,
    oneFrame,
    tag,
    frameRange,
    ignoreEmpty,
    trim,
    crop,
    slice,
    allLayers,
    layers,
    ignoreLayers,
  };
}

async function runExportSprite(
  ctx: ServerContext,
  projectPath: string,
  inputFile: string,
  output: OutputSpec,
  spec: SpriteExportSpec,
  options: CommonRunOptions,
  runAsepriteFn: AsepriteManagerDeps['runAseprite'],
): Promise<{
  ok: boolean;
  summary: string;
  errors?: ToolResponse['errors'];
  outputBaseName: string;
  format: string;
  mode: 'single' | 'frames';
  generatedCount: number;
  execution: ToolResponse['execution'];
  files: ToolResponse['files'];
}> {
  ctx.assertValidProject(projectPath);

  const inputResolved = resolvePathLikeInsideProject(projectPath, inputFile);
  const absInput = inputResolved.absPath;

  const tagSuffix = spec.tag ? `__tag_${sanitizeFileComponent(spec.tag)}` : '';
  const outputBaseName = `${output.baseName}${tagSuffix}`;

  const templateName =
    spec.mode === 'frames'
      ? `${outputBaseName}__frame_{frame}.${spec.format}`
      : `${outputBaseName}.${spec.format}`;
  const saveAsAbs = path.join(output.outputDirAbs, templateName);

  const precheck =
    spec.mode === 'frames'
      ? precheckOverwriteByPrefix(
          output.overwrite,
          output.outputDirAbs,
          outputBaseName,
        )
      : precheckOverwrite(output.overwrite, [
          { kind: 'sprite_image', absPath: saveAsAbs },
        ]);
  if (precheck) {
    return {
      ok: false,
      summary: precheck.summary,
      errors: precheck.errors,
      outputBaseName,
      format: spec.format,
      mode: spec.mode,
      generatedCount: 0,
      execution: undefined,
      files: undefined,
    };
  }

  const argv: string[] = ['-b'];
  if (options.preview) argv.push('--preview');
  if (options.verbose) argv.push('--verbose');

  for (const layer of spec.ignoreLayers) argv.push('--ignore-layer', layer);
  if (spec.allLayers) argv.push('--all-layers');
  for (const layer of spec.layers) argv.push('--layer', layer);

  if (spec.tag) argv.push('--tag', spec.tag);
  if (spec.frameRange) {
    argv.push('--frame-range', `${spec.frameRange.from},${spec.frameRange.to}`);
  }
  if (spec.ignoreEmpty) argv.push('--ignore-empty');
  if (spec.trim) argv.push('--trim');
  if (spec.crop)
    argv.push(
      '--crop',
      `${spec.crop.x},${spec.crop.y},${spec.crop.w},${spec.crop.h}`,
    );
  if (spec.slice) argv.push('--slice', spec.slice);
  if (spec.oneFrame) argv.push('--oneframe');

  argv.push(absInput);
  argv.push('--save-as', saveAsAbs);

  const result = await runAsepriteFn(argv, {
    cwd: projectPath,
    timeoutMs: options.timeoutMs,
  });

  const execution: ToolResponse['execution'] = {
    asepritePath: result.command,
    cwd: projectPath,
    argv: [result.command, ...result.args],
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    preview: options.preview,
  };

  const files = collectFilesByPrefix(
    inputResolved.projectRootAbs,
    output.outputDirAbs,
    outputBaseName,
    options.preview,
    { imageKind: spec.mode === 'frames' ? 'frame_image' : 'sprite_image' },
  );

  return {
    ok: result.ok,
    summary: result.ok ? 'Aseprite export completed' : result.summary,
    outputBaseName,
    format: spec.format,
    mode: spec.mode,
    generatedCount: files.length,
    execution,
    files,
  };
}

async function runAutoImportCheck(
  baseHandlers: BaseToolHandlers,
  projectPath: string,
  files: string[],
  forceReimport: boolean,
): Promise<ToolResponse> {
  return await callBaseTool(baseHandlers, 'godot_asset_manager', {
    action: 'auto_import_check',
    projectPath,
    files,
    forceReimport,
  });
}

export function createAsepriteManagerToolHandlers(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  depsOverride: Partial<AsepriteManagerDeps> = {},
): Record<string, ToolHandler> {
  const deps: AsepriteManagerDeps = {
    getAsepriteStatus: depsOverride.getAsepriteStatus ?? getAsepriteStatus,
    runAseprite: depsOverride.runAseprite ?? runAseprite,
  };

  return {
    aseprite_manager: async (args: unknown): Promise<ToolResponse> => {
      const runId = randomUUID();
      const timestamp = nowIso();

      const argsObj = asRecord(args, 'args');
      const actionRaw = asNonEmptyString(argsObj.action, 'action');
      const action = normalizeAction(actionRaw);

      const options = parseCommonRunOptions(argsObj);

      if (action === 'doctor') {
        const status = deps.getAsepriteStatus();
        const ready = Boolean(
          status.externalToolsEnabled && status.resolvedExecutable,
        );
        if (!ready) {
          return {
            ok: false,
            action,
            runId,
            timestamp,
            summary: 'Aseprite is not available (disabled or not found)',
            details: {
              found: false,
              version: null,
              supportsPreview: false,
              supportsSheetExport: false,
              status,
              suggestions: [
                ...(status.externalToolsEnabled
                  ? []
                  : [
                      'Set ALLOW_EXTERNAL_TOOLS=true to enable external tools.',
                    ]),
                ...(status.resolvedExecutable
                  ? []
                  : [
                      'Set ASEPRITE_PATH to your Aseprite install directory or executable path.',
                    ]),
              ],
            },
          };
        }

        const help = await deps.runAseprite(['--help'], {
          timeoutMs: options.timeoutMs,
        });
        const helpText = `${help.stdout}\n${help.stderr}`.toLowerCase();
        const supportsPreview = helpText.includes('--preview');
        const supportsSheetExport =
          helpText.includes('--sheet') && helpText.includes('--data');

        const versionRes = await deps.runAseprite(['--version'], {
          timeoutMs: options.timeoutMs,
        });
        const versionLine =
          splitLines(versionRes.stdout)[0] ??
          splitLines(versionRes.stderr)[0] ??
          null;

        const logs = [
          ...splitLines(help.stdout),
          ...splitLines(help.stderr).map((l) => `[stderr] ${l}`),
        ].slice(0, 200);

        return {
          ok: help.ok,
          action,
          runId,
          timestamp,
          summary: help.ok
            ? 'Aseprite is available'
            : 'Aseprite is available but --help failed',
          execution: {
            asepritePath: help.command,
            cwd: process.cwd(),
            argv: [help.command, ...help.args],
            exitCode: help.exitCode,
            durationMs: help.durationMs,
            preview: false,
          },
          logs,
          details: {
            found: true,
            version: versionLine,
            supportsPreview,
            supportsSheetExport,
            status,
            capabilities: help.capabilities,
            suggestions: help.suggestions,
          },
        };
      }

      if (action === 'version') {
        const result = await deps.runAseprite(['--version'], {
          timeoutMs: options.timeoutMs,
        });
        const versionLine = splitLines(result.stdout)[0] ?? '';
        return {
          ok: result.ok && versionLine.length > 0,
          action,
          runId,
          timestamp,
          summary: result.ok ? 'Aseprite version retrieved' : result.summary,
          execution: {
            asepritePath: result.command,
            cwd: process.cwd(),
            argv: [result.command, ...result.args],
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            preview: false,
          },
          details: {
            version: versionLine || splitLines(result.stderr)[0] || '',
          },
          logs: [
            ...splitLines(result.stdout),
            ...splitLines(result.stderr).map((l) => `[stderr] ${l}`),
          ].slice(0, 50),
        };
      }

      const projectPath = asNonEmptyString(argsObj.projectPath, 'projectPath');
      ctx.assertValidProject(projectPath);

      const projectRootResolved = resolvePathLikeInsideProject(
        projectPath,
        'res://',
      );
      const projectRootAbs = projectRootResolved.projectRootAbs;

      if (action === 'list_tags') {
        const inputFile = asNonEmptyString(argsObj.inputFile, 'inputFile');
        const inputResolved = resolvePathLikeInsideProject(
          projectPath,
          inputFile,
        );

        const argv: string[] = ['-b'];
        if (options.verbose) argv.push('--verbose');
        argv.push('--list-tags', inputResolved.absPath);

        const result = await deps.runAseprite(argv, {
          cwd: projectPath,
          timeoutMs: options.timeoutMs,
        });

        return {
          ok: result.ok,
          action,
          runId,
          timestamp,
          summary: result.ok ? 'Tags listed' : result.summary,
          execution: {
            asepritePath: result.command,
            cwd: projectPath,
            argv: [result.command, ...result.args],
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            preview: false,
          },
          details: { tags: splitLines(result.stdout) },
        };
      }

      if (action === 'list_layers') {
        const inputFile = asNonEmptyString(argsObj.inputFile, 'inputFile');
        const hierarchy =
          asOptionalBoolean(argsObj.hierarchy, 'hierarchy') ?? false;

        const inputResolved = resolvePathLikeInsideProject(
          projectPath,
          inputFile,
        );

        const argv: string[] = ['-b'];
        if (options.verbose) argv.push('--verbose');
        argv.push(
          hierarchy ? '--list-layer-hierarchy' : '--list-layers',
          inputResolved.absPath,
        );

        const result = await deps.runAseprite(argv, {
          cwd: projectPath,
          timeoutMs: options.timeoutMs,
        });

        return {
          ok: result.ok,
          action,
          runId,
          timestamp,
          summary: result.ok ? 'Layers listed' : result.summary,
          execution: {
            asepritePath: result.command,
            cwd: projectPath,
            argv: [result.command, ...result.args],
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            preview: false,
          },
          details: { layers: splitLines(result.stdout), hierarchy },
        };
      }

      if (action === 'list_slices') {
        const inputFile = asNonEmptyString(argsObj.inputFile, 'inputFile');
        const inputResolved = resolvePathLikeInsideProject(
          projectPath,
          inputFile,
        );

        const argv: string[] = ['-b'];
        if (options.verbose) argv.push('--verbose');
        argv.push('--list-slices', inputResolved.absPath);

        const result = await deps.runAseprite(argv, {
          cwd: projectPath,
          timeoutMs: options.timeoutMs,
        });

        return {
          ok: result.ok,
          action,
          runId,
          timestamp,
          summary: result.ok ? 'Slices listed' : result.summary,
          execution: {
            asepritePath: result.command,
            cwd: projectPath,
            argv: [result.command, ...result.args],
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            preview: false,
          },
          details: { slices: splitLines(result.stdout) },
        };
      }

      if (action === 'export_sheet') {
        const inputFile = asNonEmptyString(argsObj.inputFile, 'inputFile');
        const inputResolved = resolvePathLikeInsideProject(
          projectPath,
          inputFile,
        );

        const output = parseOutputSpec(
          projectPath,
          projectRootAbs,
          argsObj,
          inputResolved.absPath,
          options.preview,
        );
        const sheet = parseSheetSpec(argsObj);

        const exportResult = await runExportSheet(
          ctx,
          projectPath,
          inputFile,
          output,
          sheet,
          options,
          deps.runAseprite,
        );

        return {
          ok: exportResult.ok,
          action,
          runId,
          timestamp,
          summary: exportResult.summary,
          ...(exportResult.errors ? { errors: exportResult.errors } : {}),
          execution: exportResult.execution,
          files: exportResult.files,
          details: {
            outputBaseName: exportResult.outputBaseName,
            sheetType: sheet.sheetType,
            dataFormat: sheet.format,
            tag: exportResult.tag,
            dataReturnedViaStdout: exportResult.dataReturnedViaStdout,
            ...(exportResult.dataReturnedViaStdout
              ? { dataJson: exportResult.dataJson }
              : {}),
          },
        };
      }

      if (action === 'export_sheets_by_tags') {
        const inputFile = asNonEmptyString(argsObj.inputFile, 'inputFile');
        const inputResolved = resolvePathLikeInsideProject(
          projectPath,
          inputFile,
        );
        const output = parseOutputSpec(
          projectPath,
          projectRootAbs,
          argsObj,
          inputResolved.absPath,
          options.preview,
        );
        const sheet = parseSheetSpec(argsObj);

        const tagsValue = argsObj.tags;
        const tags =
          tagsValue === 'all'
            ? (() => {
                // Prefer Aseprite list-tags output.
                return null;
              })()
            : Array.isArray(tagsValue)
              ? tagsValue.filter((v): v is string => typeof v === 'string')
              : null;

        let tagList: string[];
        if (tags) {
          tagList = tags.map((t) => t.trim()).filter(Boolean);
        } else {
          const listResp = await (async () => {
            const argv: string[] = ['-b'];
            if (options.verbose) argv.push('--verbose');
            argv.push('--list-tags', inputResolved.absPath);
            return await deps.runAseprite(argv, {
              cwd: projectPath,
              timeoutMs: options.timeoutMs,
            });
          })();
          if (!listResp.ok) {
            return {
              ok: false,
              action,
              runId,
              timestamp,
              summary: listResp.summary,
              execution: {
                asepritePath: listResp.command,
                cwd: projectPath,
                argv: [listResp.command, ...listResp.args],
                exitCode: listResp.exitCode,
                durationMs: listResp.durationMs,
                preview: false,
              },
              details: {
                suggestions: listResp.suggestions,
              },
              logs: [
                ...splitLines(listResp.stdout),
                ...splitLines(listResp.stderr).map((l) => `[stderr] ${l}`),
              ].slice(0, 100),
            };
          }
          tagList = splitLines(listResp.stdout);
        }

        const results: Array<{
          tag: string;
          ok: boolean;
          sheetResPath: string | null;
          dataResPath: string | null;
        }> = [];
        const files: ToolResponse['files'] = [];

        let allOk = true;
        for (const tag of tagList) {
          const exportResult = await runExportSheet(
            ctx,
            projectPath,
            inputFile,
            output,
            sheet,
            options,
            deps.runAseprite,
            { tagValue: tag, tagSuffix: `__tag_${sanitizeFileComponent(tag)}` },
          );

          const sheetFile = exportResult.files?.find(
            (f) => f.kind === 'sheet_image',
          );
          const dataFile = exportResult.files?.find(
            (f) => f.kind === 'sheet_data',
          );

          results.push({
            tag,
            ok: exportResult.ok,
            sheetResPath: sheetFile?.resPath ?? null,
            dataResPath: dataFile?.resPath ?? null,
          });

          if (exportResult.files) files.push(...exportResult.files);
          if (!exportResult.ok) allOk = false;
        }

        return {
          ok: allOk,
          action,
          runId,
          timestamp,
          summary: allOk
            ? 'Exported sheets for tags'
            : 'One or more tag exports failed',
          files,
          details: {
            outputBaseName: output.baseName,
            exportedTags: tagList,
            results,
          },
        };
      }

      if (action === 'export_sprite') {
        const inputFile = asNonEmptyString(argsObj.inputFile, 'inputFile');
        const inputResolved = resolvePathLikeInsideProject(
          projectPath,
          inputFile,
        );

        const output = parseOutputSpec(
          projectPath,
          projectRootAbs,
          argsObj,
          inputResolved.absPath,
          options.preview,
        );
        const spec = parseSpriteExportSpec(argsObj);

        const exportResult = await runExportSprite(
          ctx,
          projectPath,
          inputFile,
          output,
          spec,
          options,
          deps.runAseprite,
        );

        return {
          ok: exportResult.ok,
          action,
          runId,
          timestamp,
          summary: exportResult.summary,
          ...(exportResult.errors ? { errors: exportResult.errors } : {}),
          execution: exportResult.execution,
          files: exportResult.files,
          details: {
            outputBaseName: exportResult.outputBaseName,
            format: exportResult.format,
            mode: exportResult.mode,
            generatedCount: exportResult.generatedCount,
          },
        };
      }

      if (
        action === 'apply_palette_and_export' ||
        action === 'scale_and_export' ||
        action === 'convert_color_mode'
      ) {
        const inputFile = asNonEmptyString(argsObj.inputFile, 'inputFile');
        const inputResolved = resolvePathLikeInsideProject(
          projectPath,
          inputFile,
        );

        const output = parseOutputSpec(
          projectPath,
          projectRootAbs,
          argsObj,
          inputResolved.absPath,
          options.preview,
        );

        const exportObj = asRecord(argsObj.export, 'export');
        const format =
          (asOptionalNonEmptyString(exportObj.format, 'export.format') as
            | 'png'
            | 'gif'
            | 'webp'
            | undefined) ?? 'png';
        const mode =
          (asOptionalNonEmptyString(exportObj.mode, 'export.mode') as
            | 'single'
            | 'frames'
            | undefined) ?? 'single';

        const files: ToolResponse['files'] = [];
        const executions: ToolResponse['execution'][] = [];

        if (action === 'apply_palette_and_export') {
          const palettes = asOptionalStringArray(argsObj.palettes, 'palettes');
          if (palettes.length === 0) {
            return {
              ok: false,
              action,
              runId,
              timestamp,
              summary: 'palettes must contain at least one path',
            };
          }

          const errors: NonNullable<ToolResponse['errors']> = [];
          let allOk = true;

          for (const palettePath of palettes) {
            const paletteResolved = resolvePathLikeInsideProject(
              projectPath,
              palettePath,
            );
            const paletteStem = sanitizeFileComponent(
              path.parse(paletteResolved.absPath).name,
            );
            const outputBaseName = `${output.baseName}__pal_${paletteStem}`;
            const templateName =
              mode === 'frames'
                ? `${outputBaseName}__frame_{frame}.${format}`
                : `${outputBaseName}.${format}`;
            const saveAsAbs = path.join(output.outputDirAbs, templateName);

            const precheck =
              mode === 'frames'
                ? precheckOverwriteByPrefix(
                    output.overwrite,
                    output.outputDirAbs,
                    outputBaseName,
                  )
                : precheckOverwrite(output.overwrite, [
                    { kind: 'palette_variant', absPath: saveAsAbs },
                  ]);
            if (precheck) {
              return {
                ok: false,
                action,
                runId,
                timestamp,
                summary: precheck.summary,
                errors: precheck.errors,
              };
            }

            const argv: string[] = ['-b'];
            if (options.preview) argv.push('--preview');
            if (options.verbose) argv.push('--verbose');

            argv.push(inputResolved.absPath);
            argv.push('--palette', paletteResolved.absPath);
            argv.push('--save-as', saveAsAbs);

            const result = await deps.runAseprite(argv, {
              cwd: projectPath,
              timeoutMs: options.timeoutMs,
            });
            if (!result.ok) {
              allOk = false;
              errors.push({
                code: 'E_ASEPRITE',
                message: result.summary,
                details: {
                  palettePath,
                  outputBaseName,
                  exitCode: result.exitCode,
                },
              });
            }

            executions.push({
              asepritePath: result.command,
              cwd: projectPath,
              argv: [result.command, ...result.args],
              exitCode: result.exitCode,
              durationMs: result.durationMs,
              preview: options.preview,
            });

            files.push(
              ...collectFilesByPrefix(
                projectRootAbs,
                output.outputDirAbs,
                outputBaseName,
                options.preview,
                { imageKind: 'palette_variant' },
              ),
            );
          }

          return {
            ok: allOk,
            action,
            runId,
            timestamp,
            summary: allOk
              ? 'Palette export completed'
              : 'Palette export completed with failures',
            ...(errors.length > 0 ? { errors } : {}),
            execution: executions[0],
            files,
            details: {
              outputBaseName: output.baseName,
              paletteCount: palettes.length,
              generatedCount: files.length,
            },
          };
        }

        if (action === 'scale_and_export') {
          const scale = asNumber(argsObj.scale, 'scale');
          const scaleToken = numberToFilenameToken(scale);
          const outputBaseName = `${output.baseName}__x${scaleToken}`;
          const templateName =
            mode === 'frames'
              ? `${outputBaseName}__frame_{frame}.${format}`
              : `${outputBaseName}.${format}`;
          const saveAsAbs = path.join(output.outputDirAbs, templateName);

          const precheck =
            mode === 'frames'
              ? precheckOverwriteByPrefix(
                  output.overwrite,
                  output.outputDirAbs,
                  outputBaseName,
                )
              : precheckOverwrite(output.overwrite, [
                  { kind: 'sprite_image', absPath: saveAsAbs },
                ]);
          if (precheck) {
            return {
              ok: false,
              action,
              runId,
              timestamp,
              summary: precheck.summary,
              errors: precheck.errors,
            };
          }

          const argv: string[] = ['-b'];
          if (options.preview) argv.push('--preview');
          if (options.verbose) argv.push('--verbose');

          argv.push(inputResolved.absPath);
          argv.push('--scale', String(scale));
          argv.push('--save-as', saveAsAbs);

          const result = await deps.runAseprite(argv, {
            cwd: projectPath,
            timeoutMs: options.timeoutMs,
          });

          const filesOut = collectFilesByPrefix(
            projectRootAbs,
            output.outputDirAbs,
            outputBaseName,
            options.preview,
            { imageKind: mode === 'frames' ? 'frame_image' : 'sprite_image' },
          );

          return {
            ok: result.ok,
            action,
            runId,
            timestamp,
            summary: result.ok ? 'Scale export completed' : result.summary,
            execution: {
              asepritePath: result.command,
              cwd: projectPath,
              argv: [result.command, ...result.args],
              exitCode: result.exitCode,
              durationMs: result.durationMs,
              preview: options.preview,
            },
            files: filesOut,
            details: {
              outputBaseName: output.baseName,
              scale,
              generatedCount: filesOut.length,
            },
          };
        }

        if (action === 'convert_color_mode') {
          const colorMode = asNonEmptyString(argsObj.colorMode, 'colorMode');
          const outputBaseName = `${output.baseName}__cm_${sanitizeFileComponent(colorMode)}`;
          const templateName =
            mode === 'frames'
              ? `${outputBaseName}__frame_{frame}.${format}`
              : `${outputBaseName}.${format}`;
          const saveAsAbs = path.join(output.outputDirAbs, templateName);

          const precheck =
            mode === 'frames'
              ? precheckOverwriteByPrefix(
                  output.overwrite,
                  output.outputDirAbs,
                  outputBaseName,
                )
              : precheckOverwrite(output.overwrite, [
                  { kind: 'sprite_image', absPath: saveAsAbs },
                ]);
          if (precheck) {
            return {
              ok: false,
              action,
              runId,
              timestamp,
              summary: precheck.summary,
              errors: precheck.errors,
            };
          }

          const ditheringObj = asOptionalRecord(argsObj.dithering, 'dithering');
          const ditherAlgorithm = ditheringObj
            ? asOptionalNonEmptyString(
                ditheringObj.algorithm,
                'dithering.algorithm',
              )
            : undefined;
          const ditherMatrix = ditheringObj
            ? asOptionalNonEmptyString(ditheringObj.matrix, 'dithering.matrix')
            : undefined;

          const argv: string[] = ['-b'];
          if (options.preview) argv.push('--preview');
          if (options.verbose) argv.push('--verbose');

          argv.push(inputResolved.absPath);
          if (ditherAlgorithm)
            argv.push('--dithering-algorithm', ditherAlgorithm);
          if (ditherMatrix) argv.push('--dithering-matrix', ditherMatrix);
          argv.push('--color-mode', colorMode);
          argv.push('--save-as', saveAsAbs);

          const result = await deps.runAseprite(argv, {
            cwd: projectPath,
            timeoutMs: options.timeoutMs,
          });

          const filesOut = collectFilesByPrefix(
            projectRootAbs,
            output.outputDirAbs,
            outputBaseName,
            options.preview,
            { imageKind: mode === 'frames' ? 'frame_image' : 'sprite_image' },
          );

          return {
            ok: result.ok,
            action,
            runId,
            timestamp,
            summary: result.ok ? 'Color mode export completed' : result.summary,
            execution: {
              asepritePath: result.command,
              cwd: projectPath,
              argv: [result.command, ...result.args],
              exitCode: result.exitCode,
              durationMs: result.durationMs,
              preview: options.preview,
            },
            files: filesOut,
            details: {
              outputBaseName: output.baseName,
              colorMode,
              generatedCount: filesOut.length,
            },
          };
        }
      }

      if (action === 'export_sheet_and_reimport') {
        const inputFile = asNonEmptyString(argsObj.inputFile, 'inputFile');
        const inputResolved = resolvePathLikeInsideProject(
          projectPath,
          inputFile,
        );
        const output = parseOutputSpec(
          projectPath,
          projectRootAbs,
          argsObj,
          inputResolved.absPath,
          options.preview,
        );
        const sheet = parseSheetSpec(argsObj);
        const exportResult = await runExportSheet(
          ctx,
          projectPath,
          inputFile,
          output,
          sheet,
          options,
          deps.runAseprite,
        );

        const reimportObj =
          asOptionalRecord(argsObj.reimport, 'reimport') ?? {};
        const forceReimport =
          asOptionalBoolean(
            reimportObj.forceReimport,
            'reimport.forceReimport',
          ) ?? false;
        const overrideFiles = asOptionalStringArray(
          reimportObj.files,
          'reimport.files',
        );

        const generatedResFiles =
          exportResult.files
            ?.map((f) => f.resPath)
            .filter((p): p is string => typeof p === 'string') ?? [];

        const autoImportFiles =
          overrideFiles.length > 0 ? overrideFiles : generatedResFiles;

        const autoImport = await runAutoImportCheck(
          baseHandlers,
          projectPath,
          autoImportFiles,
          forceReimport,
        );

        return {
          ok: exportResult.ok && autoImport.ok,
          action,
          runId,
          timestamp,
          summary: exportResult.ok
            ? autoImport.ok
              ? 'Export + reimport completed'
              : 'Export completed, but reimport failed'
            : exportResult.summary,
          execution: exportResult.execution,
          files: exportResult.files,
          details: {
            ...(exportResult.ok
              ? {
                  outputBaseName: exportResult.outputBaseName,
                  sheetType: sheet.sheetType,
                  dataFormat: sheet.format,
                  tag: exportResult.tag,
                  dataReturnedViaStdout: exportResult.dataReturnedViaStdout,
                }
              : {}),
            godotAutoImportCheck: {
              ok: autoImport.ok,
              summary: autoImport.summary,
              details: autoImport.details,
            },
          },
        };
      }

      if (action === 'export_sheets_by_tags_and_reimport') {
        const inputFile = asNonEmptyString(argsObj.inputFile, 'inputFile');
        const inputResolved = resolvePathLikeInsideProject(
          projectPath,
          inputFile,
        );
        const output = parseOutputSpec(
          projectPath,
          projectRootAbs,
          argsObj,
          inputResolved.absPath,
          options.preview,
        );
        const sheet = parseSheetSpec(argsObj);

        const tagsValue = argsObj.tags;
        const tags =
          tagsValue === 'all'
            ? null
            : Array.isArray(tagsValue)
              ? tagsValue.filter((v): v is string => typeof v === 'string')
              : null;

        let tagList: string[];
        if (tags) {
          tagList = tags.map((t) => t.trim()).filter(Boolean);
        } else {
          const listResp = await (async () => {
            const argv: string[] = ['-b'];
            if (options.verbose) argv.push('--verbose');
            argv.push('--list-tags', inputResolved.absPath);
            return await deps.runAseprite(argv, {
              cwd: projectPath,
              timeoutMs: options.timeoutMs,
            });
          })();
          if (!listResp.ok) {
            return {
              ok: false,
              action,
              runId,
              timestamp,
              summary: listResp.summary,
              execution: {
                asepritePath: listResp.command,
                cwd: projectPath,
                argv: [listResp.command, ...listResp.args],
                exitCode: listResp.exitCode,
                durationMs: listResp.durationMs,
                preview: false,
              },
              details: {
                suggestions: listResp.suggestions,
              },
              logs: [
                ...splitLines(listResp.stdout),
                ...splitLines(listResp.stderr).map((l) => `[stderr] ${l}`),
              ].slice(0, 100),
            };
          }
          tagList = splitLines(listResp.stdout);
        }

        const results: Array<{
          tag: string;
          ok: boolean;
          sheetResPath: string | null;
          dataResPath: string | null;
        }> = [];
        const files: ToolResponse['files'] = [];
        const generatedResFiles: string[] = [];

        let allOk = true;
        for (const tag of tagList) {
          const exportResult = await runExportSheet(
            ctx,
            projectPath,
            inputFile,
            output,
            sheet,
            options,
            deps.runAseprite,
            { tagValue: tag, tagSuffix: `__tag_${sanitizeFileComponent(tag)}` },
          );

          const sheetFile = exportResult.files?.find(
            (f) => f.kind === 'sheet_image',
          );
          const dataFile = exportResult.files?.find(
            (f) => f.kind === 'sheet_data',
          );

          results.push({
            tag,
            ok: exportResult.ok,
            sheetResPath: sheetFile?.resPath ?? null,
            dataResPath: dataFile?.resPath ?? null,
          });

          if (exportResult.files) {
            files.push(...exportResult.files);
            for (const f of exportResult.files) {
              if (typeof f.resPath === 'string')
                generatedResFiles.push(f.resPath);
            }
          }
          if (!exportResult.ok) allOk = false;
        }

        const reimportObj =
          asOptionalRecord(argsObj.reimport, 'reimport') ?? {};
        const forceReimport =
          asOptionalBoolean(
            reimportObj.forceReimport,
            'reimport.forceReimport',
          ) ?? false;
        const overrideFiles = asOptionalStringArray(
          reimportObj.files,
          'reimport.files',
        );
        const autoImportFiles =
          overrideFiles.length > 0 ? overrideFiles : generatedResFiles;

        const autoImport = await runAutoImportCheck(
          baseHandlers,
          projectPath,
          autoImportFiles,
          forceReimport,
        );

        return {
          ok: allOk && autoImport.ok,
          action,
          runId,
          timestamp,
          summary:
            allOk && autoImport.ok
              ? 'Export tag sheets + reimport completed'
              : 'Export tag sheets and/or reimport failed',
          files,
          details: {
            outputBaseName: output.baseName,
            exportedTags: tagList,
            results,
            godotAutoImportCheck: {
              ok: autoImport.ok,
              summary: autoImport.summary,
              details: autoImport.details,
            },
          },
        };
      }

      if (action === 'batch') {
        const maxParallelJobs =
          asOptionalNumber(argsObj.maxParallelJobs, 'maxParallelJobs') ?? 4;
        const continueOnError =
          asOptionalBoolean(argsObj.continueOnError, 'continueOnError') ?? true;
        const jobsValue = argsObj.jobs;
        if (!Array.isArray(jobsValue) || jobsValue.length === 0) {
          return {
            ok: false,
            action,
            runId,
            timestamp,
            summary: 'jobs must be a non-empty array',
          };
        }

        const jobs = jobsValue
          .map((j) =>
            j && typeof j === 'object' && !Array.isArray(j)
              ? (j as Record<string, unknown>)
              : null,
          )
          .filter((j): j is Record<string, unknown> => Boolean(j));

        const runJob = async (
          job: Record<string, unknown>,
        ): Promise<{
          jobId: string;
          ok: boolean;
          action: string;
          summary: string;
        }> => {
          const jobId = asNonEmptyString(job.jobId, 'job.jobId');
          const requestObj = asRecord(job.request, 'job.request');
          const innerAction = normalizeAction(
            asNonEmptyString(requestObj.action, 'job.request.action'),
          );
          if (innerAction === 'batch') {
            return {
              jobId,
              ok: false,
              action: innerAction,
              summary: 'batch jobs cannot contain nested batch actions',
            };
          }

          if (!requestObj.projectPath) {
            requestObj.projectPath = projectPath;
          }

          const handler = createAsepriteManagerToolHandlers(
            ctx,
            baseHandlers,
            depsOverride,
          ).aseprite_manager;
          const resp = await handler(requestObj);
          return {
            jobId,
            ok: resp.ok,
            action: innerAction,
            summary: resp.summary,
          };
        };

        const jobResults: Array<{
          jobId: string;
          ok: boolean;
          action: string;
          summary: string;
        }> = [];

        if (!continueOnError) {
          for (const job of jobs) {
            const r = await runJob(job);
            jobResults.push(r);
            if (!r.ok) break;
          }
        } else {
          const concurrency = Math.max(
            1,
            Math.min(32, Math.floor(maxParallelJobs)),
          );
          let idx = 0;
          const workers: Promise<void>[] = [];
          const next = async (): Promise<void> => {
            while (idx < jobs.length) {
              const current = jobs[idx];
              idx += 1;
              if (!current) continue;
              const r = await runJob(current);
              jobResults.push(r);
            }
          };
          for (let i = 0; i < concurrency; i += 1) workers.push(next());
          await Promise.all(workers);
        }

        const succeeded = jobResults.filter((j) => j.ok).length;
        const failed = jobResults.filter((j) => !j.ok).length;

        return {
          ok: failed === 0,
          action,
          runId,
          timestamp,
          summary:
            failed === 0 ? 'Batch completed' : 'Batch completed with failures',
          details: {
            jobCount: jobResults.length,
            succeeded,
            failed,
            jobs: jobResults,
          },
        };
      }

      return {
        ok: false,
        action,
        runId,
        timestamp,
        summary: `Unknown action: ${actionRaw}`,
        details: {
          supportedActions: [
            'doctor',
            'version',
            'list_tags',
            'list_layers',
            'list_slices',
            'export_sprite',
            'export_sheet',
            'export_sheets_by_tags',
            'apply_palette_and_export',
            'scale_and_export',
            'convert_color_mode',
            'batch',
            'export_sheet_and_reimport',
            'export_sheets_by_tags_and_reimport',
          ],
        },
      };
    },
  };
}
