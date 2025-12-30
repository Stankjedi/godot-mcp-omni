export type MacroOp = { operation: string; params: Record<string, unknown> };

export type MacroDefinition = {
  id: string;
  title: string;
  description: string;
  outputs: string[];
  buildOps: () => MacroOp[];
};

export type PixelMacroConfig = {
  goal?: string;
  plan?: unknown[];
  seed?: number;
  failFast?: boolean;
  allowExternalTools?: boolean;
  specGenTimeoutMs?: number;
  exportPreview?: boolean;
  smokeTest?: boolean;
  smokeWaitMs?: number;
  previewOutputPngPath?: string;
  layerName?: string;
  outputPngPath?: string;
  scenePath?: string;
  dryRun?: boolean;
  forceRegenerate?: boolean;
};

export type PrepareResult = {
  plannedOps: number;
  ops: MacroOp[];
  created: string[];
  skippedExisting: string[];
  skippedUnchanged: string[];
  skippedDifferent: string[];
};
