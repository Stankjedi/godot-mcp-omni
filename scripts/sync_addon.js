import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

function parseArgs(argv) {
  const args = { projectPath: process.env.GODOT_PROJECT_PATH?.trim() || '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--project' || a === '--projectPath') {
      args.projectPath = String(argv[i + 1] ?? '').trim();
      i += 1;
      continue;
    }
  }
  return args;
}

function normalizeNewlines(text) {
  return text.replaceAll('\r\n', '\n');
}

function serializePackedStringArray(values) {
  const uniq = Array.from(new Set(values)).filter(Boolean);
  const quoted = uniq.map((v) => `"${String(v).replaceAll('"', '\\"')}"`).join(', ');
  return `PackedStringArray(${quoted})`;
}

function ensureEditorPluginEnabled(projectGodotText, pluginId) {
  const lines = normalizeNewlines(projectGodotText).split('\n');

  let sectionStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '[editor_plugins]') {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart === -1) {
    const out = [...lines];
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push('[editor_plugins]');
    out.push(`enabled=${serializePackedStringArray([pluginId])}`);
    out.push('');
    return out.join('\n');
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^\s*\[[^\]]+\]\s*$/u.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  let enabledLineIndex = -1;
  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    if (lines[i].trim().startsWith('enabled=')) {
      enabledLineIndex = i;
      break;
    }
  }

  if (enabledLineIndex === -1) {
    const out = [...lines];
    out.splice(sectionEnd, 0, `enabled=${serializePackedStringArray([pluginId])}`);
    return out.join('\n');
  }

  const enabledLine = lines[enabledLineIndex];
  const matches = Array.from(enabledLine.matchAll(/"([^"]*)"/gu)).map((m) => m[1]);
  const next = matches.includes(pluginId) ? matches : [...matches, pluginId];

  const out = [...lines];
  out[enabledLineIndex] = `enabled=${serializePackedStringArray(next)}`;
  return out.join('\n');
}

async function main() {
  const logs = [];
  const { projectPath } = parseArgs(process.argv.slice(2));
  if (!projectPath) {
    throw new Error('Missing --project <path> (or set GODOT_PROJECT_PATH).');
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '..');

  const absProjectPath = path.resolve(projectPath);
  const projectGodotPath = path.join(absProjectPath, 'project.godot');
  if (!(await fs.pathExists(projectGodotPath))) {
    throw new Error(`Not a Godot project (missing project.godot): ${absProjectPath}`);
  }

  const srcAddon = path.join(repoRoot, 'addons', 'godot_mcp_bridge');
  const dstAddon = path.join(absProjectPath, 'addons', 'godot_mcp_bridge');
  const lockPath = path.join(absProjectPath, '.godot_mcp', 'bridge.lock');

  if (await fs.pathExists(lockPath)) {
    throw new Error(
      `Editor bridge appears to be running. Close the editor before syncing the addon. (${lockPath})`
    );
  }

  logs.push(`Copying addon: ${srcAddon} -> ${dstAddon}`);
  await fs.ensureDir(path.dirname(dstAddon));
  await fs.copy(srcAddon, dstAddon, { overwrite: true });

  logs.push(`Ensuring editor plugin enabled: godot_mcp_bridge`);
  const before = await fs.readFile(projectGodotPath, 'utf8');
  const after = ensureEditorPluginEnabled(before, 'godot_mcp_bridge');
  if (after !== normalizeNewlines(before)) {
    await fs.writeFile(projectGodotPath, after, 'utf8');
  }

  console.log(
    JSON.stringify({
      ok: true,
      summary: 'Addon synced to project.',
      details: {
        projectPath: absProjectPath,
        addonPath: dstAddon,
        projectGodotPath,
      },
      logs,
    })
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ ok: false, summary: message, logs: [] }));
  process.exit(1);
});
