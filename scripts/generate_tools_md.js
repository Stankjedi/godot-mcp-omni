import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_DEFS_DIR = path.join(
  __dirname,
  '..',
  'build',
  'tools',
  'definitions',
);
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'TOOLS.md');

function usage() {
  return [
    'Usage:',
    '  node scripts/generate_tools_md.js [--check]',
    '',
    'Options:',
    '  --check        Exit non-zero if docs/TOOLS.md is out of date (no write)',
    '  --help, -h     Show this help message',
    '',
    'Notes:',
    '  - Requires build outputs to exist (run `npm run build` first).',
    '  - Sources tool definitions from build/tools/definitions/*.js.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let check = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') return { help: true, check: true };
    if (a === '--check') {
      check = true;
      continue;
    }
    throw new Error(`Unknown argument: ${a}\n\n${usage()}`);
  }
  return { help: false, check };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string');
}

function getActionEnum(inputSchema) {
  if (!isRecord(inputSchema)) return [];
  const props = inputSchema.properties;
  if (!isRecord(props)) return [];
  const action = props.action;
  if (!isRecord(action)) return [];
  return asStringArray(action.enum);
}

function getRequiredKeys(inputSchema) {
  if (!isRecord(inputSchema)) return [];
  return asStringArray(inputSchema.required);
}

function formatToolSection(tool) {
  const name = typeof tool?.name === 'string' ? tool.name : '(unknown)';
  const description =
    typeof tool?.description === 'string' ? tool.description.trim() : '';
  const required = getRequiredKeys(tool?.inputSchema);
  const actionEnum = getActionEnum(tool?.inputSchema);

  const lines = [];
  lines.push(`## \`${name}\``);
  if (description) {
    lines.push('');
    lines.push(description);
  }
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(
    `| Required keys | ${required.length ? required.map((k) => `\`${k}\``).join(', ') : '—'} |`,
  );
  lines.push(
    `| Action enum | ${actionEnum.length ? actionEnum.map((v) => `\`${v}\``).join(', ') : '—'} |`,
  );
  lines.push('');
  return lines.join('\n');
}

async function formatMarkdown(mdText) {
  const config = (await resolveConfig(OUTPUT_PATH)) ?? {};
  return await format(mdText, { ...config, parser: 'markdown' });
}

async function loadToolDefinitions() {
  const sources = [
    { file: 'headless_tools.js', exportName: 'HEADLESS_TOOL_DEFINITIONS' },
    { file: 'editor_rpc_tools.js', exportName: 'EDITOR_RPC_TOOL_DEFINITIONS' },
    { file: 'project_tools.js', exportName: 'PROJECT_TOOL_DEFINITIONS' },
    { file: 'unified_tools.js', exportName: 'UNIFIED_TOOL_DEFINITIONS' },
    {
      file: 'meta_tool_manager_tools.js',
      exportName: 'META_TOOL_MANAGER_TOOL_DEFINITIONS',
    },
    { file: 'server_tools.js', exportName: 'SERVER_TOOL_DEFINITIONS' },
    { file: 'aseprite_tools.js', exportName: 'ASEPRITE_TOOL_DEFINITIONS' },
    {
      file: 'pixel_manager_tools.js',
      exportName: 'PIXEL_MANAGER_TOOL_DEFINITIONS',
    },
    { file: 'macro_tools.js', exportName: 'MACRO_TOOL_DEFINITIONS' },
    { file: 'pixel_tools.js', exportName: 'PIXEL_TOOL_DEFINITIONS' },
    { file: 'workflow_tools.js', exportName: 'WORKFLOW_TOOL_DEFINITIONS' },
  ];

  for (const src of sources) {
    const p = path.join(BUILD_DEFS_DIR, src.file);
    if (!fs.existsSync(p)) {
      throw new Error(
        `Missing build output: ${p}\n` +
          'Run `npm run build` before generating docs.',
      );
    }
  }

  const all = [];
  for (const src of sources) {
    const p = path.join(BUILD_DEFS_DIR, src.file);
    const mod = await import(pathToFileURL(p).href);
    const arr = mod?.[src.exportName];
    if (!Array.isArray(arr)) {
      throw new Error(
        `Invalid export in ${src.file}: expected ${src.exportName} to be an array.`,
      );
    }
    all.push(...arr);
  }

  return all
    .filter((t) => isRecord(t) && typeof t.name === 'string')
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
    return;
  }

  if (parsed.help) {
    console.log(usage());
    process.exit(0);
    return;
  }

  let tools;
  try {
    tools = await loadToolDefinitions();
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(2);
    return;
  }

  const lines = [];
  lines.push('# Tools');
  lines.push('');
  lines.push(
    'This document is generated from the build-time tool definition modules.',
  );
  lines.push('');
  lines.push('- Source: `build/tools/definitions/*.js`');
  lines.push('- Generator: `scripts/generate_tools_md.js`');
  lines.push('');
  lines.push(`Total tools: ${tools.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const tool of tools) {
    lines.push(formatToolSection(tool));
  }

  const next = await formatMarkdown(`${lines.join('\n')}\n`);

  if (parsed.check) {
    let existing = null;
    try {
      existing = await fsp.readFile(OUTPUT_PATH, 'utf8');
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        console.error(
          `ERROR: ${path.relative(process.cwd(), OUTPUT_PATH)} is missing.`,
        );
        process.exit(1);
        return;
      }
      console.error(`ERROR: failed to read ${OUTPUT_PATH}: ${String(error)}`);
      process.exit(1);
      return;
    }

    if (existing !== next) {
      console.error(
        `ERROR: ${path.relative(process.cwd(), OUTPUT_PATH)} is out of date.`,
      );
      console.error('Action: run `npm run docs:tools` to regenerate.');
      process.exit(1);
      return;
    }

    console.log('OK: docs/TOOLS.md is up to date.');
    process.exit(0);
    return;
  }

  await fsp.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fsp.writeFile(OUTPUT_PATH, next, 'utf8');
  console.log(
    `OK: wrote ${path.relative(process.cwd(), OUTPUT_PATH)} (${tools.length} tools).`,
  );
}

await main();
