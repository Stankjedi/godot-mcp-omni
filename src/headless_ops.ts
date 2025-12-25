import { execGodot, formatCommand } from './godot_cli.js';

export interface HeadlessOpOptions {
  godotPath: string;
  projectPath: string;
  operationsScriptPath: string;
  operation: string;
  params: Record<string, unknown>;
  godotDebugMode?: boolean;
  debug?: (message: string) => void;
}

export interface ParsedJsonResult {
  ok?: boolean;
  summary?: string;
  details?: Record<string, unknown>;
  logs?: string[];
  [key: string]: unknown;
}

export interface HeadlessOpResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  parsed?: ParsedJsonResult;
}

function extractLastJsonObject(text: string): ParsedJsonResult | undefined {
  const lines = text
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(line) as ParsedJsonResult;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // ignore
    }
  }
  return undefined;
}

export async function executeHeadlessOperation(
  options: HeadlessOpOptions,
): Promise<HeadlessOpResult> {
  const paramsJson = JSON.stringify(options.params ?? {});

  const args: string[] = [
    '--headless',
    '--path',
    options.projectPath,
    '--script',
    options.operationsScriptPath,
    options.operation,
    paramsJson,
  ];

  if (options.godotDebugMode) args.push('--debug-godot');

  options.debug?.(
    `Headless op command: ${formatCommand(options.godotPath, args)}`,
  );

  const { stdout, stderr, exitCode } = await execGodot(options.godotPath, args);
  const parsed = extractLastJsonObject(stdout) ?? extractLastJsonObject(stderr);

  return { stdout, stderr, exitCode, parsed };
}
